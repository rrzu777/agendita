'use server'

import { z } from 'zod'
import { prisma } from '@/lib/db'
import type { Prisma, TimeBlock, TimeBlockSeries } from '@prisma/client'
import { revalidatePath } from 'next/cache'
import { checkRateLimit } from '@/lib/rate-limit'
import { revalidateBusinessPublicPaths } from './revalidate-business'
import { requireBusiness, requireBusinessRole, ForbiddenError } from '@/lib/auth/server'
import { action, UserError } from '@/lib/actions/result'
import { differenceInMilliseconds, addDays } from 'date-fns'
import { getEffectiveBlocks, type EffectiveBlock } from '@/lib/availability/effective-blocks'
import { computeServiceFit, SERVICE_FIT_WINDOW_DAYS } from '@/lib/availability/service-fit'
import { getLocalDateStr } from '@/lib/availability/timezone'
import { computeSeriesUntil, expandSeries, type SeriesEndMode } from '@/lib/calendar/expand-series'
import { planSeriesUpdate } from '@/lib/calendar/series-update-plan'
import { timeToMinutes } from '@/lib/availability/time-range'
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz'

const MAX_BLOCK_DURATION_MS = 32 * 24 * 60 * 60 * 1000 // 32 dias


/**
 * Filtro de reservas activas que solapan [start, end]. Un hold
 * `pending_payment` con `holdExpiresAt` ya vencido no bloquea (misma semántica
 * que generateSlots/assertSlotIsAvailable), aunque el cron aún no lo haya
 * marcado como `expired`.
 */
function overlappingActiveBookingsWhere(businessId: string, start: Date, end: Date, now: Date): Prisma.BookingWhereInput {
  return {
    businessId,
    startDateTime: { lt: end },
    endDateTime: { gt: start },
    OR: [
      { status: { in: ['confirmed', 'completed'] } },
      {
        status: 'pending_payment',
        OR: [{ holdExpiresAt: null }, { holdExpiresAt: { gt: now } }],
      },
    ],
  }
}

/**
 * Ocurrencias de una serie propuesta que chocan con reservas activas dentro de
 * la ventana de reserva del negocio (la misma que ven las clientas al agendar).
 * Devuelve las fechas locales en conflicto (yyyy-MM-dd, deduplicadas) y las
 * ocurrencias expandidas, para reutilizarlas en el addendum de fit.
 */
async function findSeriesBookingConflicts(
  businessId: string,
  proposed: Parameters<typeof expandSeries>[0],
  timezone: string,
  now: Date,
  bookingWindowDays: number,
): Promise<{ occurrences: EffectiveBlock[]; overlappingDates: string[] }> {
  const checkEnd = addDays(now, bookingWindowDays)
  const occurrences = expandSeries(proposed, [], now, checkEnd, timezone)
  const bookings = await prisma.booking.findMany({
    where: overlappingActiveBookingsWhere(businessId, now, checkEnd, now),
    select: { startDateTime: true, endDateTime: true },
  })
  const overlappingDates = Array.from(
    new Set(
      occurrences
        .filter((occ) => bookings.some((b) => occ.startDateTime < b.endDateTime && b.startDateTime < occ.endDateTime))
        .map((occ) => getLocalDateStr(occ.startDateTime, timezone)),
    ),
  )
  return { occurrences, overlappingDates }
}

/** Mensaje de confirmación para una serie en conflicto (lista truncada a 3 fechas). */
function buildSeriesConflictMessage(intro: string, overlappingDates: string[], instruction: string, addendum: string): string {
  const firstDates = overlappingDates.slice(0, 3).join(', ')
  const suffix = overlappingDates.length > 3 ? ', …' : ''
  return (
    `${intro} se solapa con reservas existentes en ${overlappingDates.length} día(s): ${firstDates}${suffix}. ` +
    `${instruction} (no se cancelarán las reservas existentes).` +
    addendum
  )
}

/**
 * Texto adicional para los mensajes de confirmación: servicios activos que hoy
 * caben en algún día pero que con el bloqueo propuesto no cabrían en ninguno.
 * Es un aviso best-effort — si algo falla, no rompe el flujo de guardado.
 */
async function serviceFitAddendum(
  businessId: string,
  timezone: string,
  proposedBlocks: { startDateTime: Date; endDateTime: Date }[],
  now: Date,
  excludeBlock?: (block: EffectiveBlock) => boolean,
): Promise<string> {
  try {
    const [services, rules] = await Promise.all([
      prisma.service.findMany({ where: { businessId, isActive: true } }),
      prisma.availabilityRule.findMany({ where: { businessId, isActive: true } }),
    ])
    if (services.length === 0 || rules.length === 0) return ''

    const fitWindowEnd = addDays(now, SERVICE_FIT_WINDOW_DAYS + 1)
    let blocks = await getEffectiveBlocks(businessId, now, fitWindowEnd, timezone)
    if (excludeBlock) blocks = blocks.filter((b) => !excludeBlock(b))
    // Las ocurrencias fuera de la ventana simulada son ruido puro para el fit
    const proposedInWindow = proposedBlocks.filter((b) => b.startDateTime < fitWindowEnd)

    const withProposed = computeServiceFit(services, rules, [...blocks, ...proposedInWindow], timezone, now)
    const candidates = withProposed.filter((a) => a.fitsNowhere)
    if (candidates.length === 0) return ''

    // La pasada "antes" solo hace falta para los servicios que quedarían sin
    // días: un servicio que ya no cabía hoy no "pasa a no caber" por el bloqueo.
    const before = computeServiceFit(
      services.filter((svc) => candidates.some((c) => c.serviceId === svc.id)),
      rules,
      blocks,
      timezone,
      now,
    )

    return candidates
      .filter((a) => before.some((b) => b.serviceId === a.serviceId && !b.fitsNowhere))
      .map((s) => ` Además, con este bloqueo "${s.serviceName}" no cabría en ningún día.`)
      .join('')
  } catch {
    return ''
  }
}

const TOLERANCE_TOO_BIG_MESSAGE = 'La tolerancia no puede superar la mitad de la duración del bloqueo'

// La coerción vive en el schema (una sola fuente): las server actions pueden
// recibir Date o string serializado según el transporte.
const createTimeBlockSchema = z.object({
  startDateTime: z.coerce.date(),
  endDateTime: z.coerce.date(),
  reason: z.string().max(255).nullable().default(null),
  overlapToleranceMinutes: z.coerce.number().int().min(0).max(240).default(0),
  confirmOverlap: z.boolean().default(false),
}).refine(data => data.endDateTime > data.startDateTime, {
  message: 'La fecha de fin debe ser posterior a la de inicio',
}).refine(data => {
  const durationMinutes = (data.endDateTime.getTime() - data.startDateTime.getTime()) / 60_000
  return data.overlapToleranceMinutes <= durationMinutes / 2
}, { message: TOLERANCE_TOO_BIG_MESSAGE })

async function rateLimitOrThrow(key: string) {
  const limit = await checkRateLimit(key, 20, 60000)
  if (!limit.success) throw new UserError('Demasiadas solicitudes. Intenta de nuevo en unos minutos.')
}

function revalidateTimeBlocks(businessId: string) {
  revalidatePath('/dashboard/availability')
  revalidatePath('/dashboard/calendar')
  return revalidateBusinessPublicPaths(businessId)
}

export async function getTimeBlocks() {
  const { businessId } = await requireBusiness()
  return prisma.timeBlock.findMany({
    where: { businessId },
    orderBy: { startDateTime: 'asc' },
  })
}

async function _createTimeBlock(data: Omit<TimeBlock, 'id' | 'createdAt' | 'businessId' | 'overlapToleranceMinutes'> & { overlapToleranceMinutes?: number; confirmOverlap?: boolean }) {
  const { businessId, business } = await requireBusinessRole(['owner', 'admin'])
  const limit = await checkRateLimit('create-timeblock', 20, 60000)
  if (!limit.success) {
    throw new UserError('Demasiadas solicitudes. Intenta de nuevo en unos minutos.')
  }

  const parsed = createTimeBlockSchema.safeParse(data)
  if (!parsed.success) {
    throw new UserError('Datos inválidos: ' + parsed.error.issues.map(i => i.message).join(', '))
  }
  const { startDateTime, endDateTime, reason, overlapToleranceMinutes, confirmOverlap } = parsed.data

  const durationMs = differenceInMilliseconds(endDateTime, startDateTime)
  if (durationMs > MAX_BLOCK_DURATION_MS) {
    throw new UserError('La duración máxima de un bloqueo es de 32 días')
  }

  const now = new Date()
  const overlappingBookings = await prisma.booking.findMany({
    where: overlappingActiveBookingsWhere(businessId, startDateTime, endDateTime, now),
    select: { id: true },
    take: 1,
  })

  if (overlappingBookings.length > 0 && confirmOverlap !== true) {
    // No es un error: es un estado "requiere confirmación". Devolvemos un
    // resultado estructurado en lugar de lanzar, para no generar un 500 (y su
    // ruido en los logs) en un flujo de validación esperado.
    const timezone = business.timezone || 'America/Santiago'
    const addendum = await serviceFitAddendum(businessId, timezone, [{ startDateTime, endDateTime }], now)
    return {
      requiresConfirmation: true as const,
      message:
        'El bloqueo se solapa con reservas existentes. ' +
        'Marca la casilla de confirmación si deseas crearlo de todas formas ' +
        '(no se cancelarán las reservas existentes).' +
        addendum,
    }
  }

  const newBlock = await prisma.timeBlock.create({
    data: { startDateTime, endDateTime, reason, overlapToleranceMinutes, businessId },
  })
  revalidatePath('/dashboard/availability')
  revalidatePath('/dashboard/calendar')
  await revalidateBusinessPublicPaths(newBlock.businessId)
  return newBlock
}

export const createTimeBlock = action(_createTimeBlock)

export async function getTimeBlocksByRange(start: Date, end: Date) {
  const { businessId, business } = await requireBusiness()
  if (!(start instanceof Date) || isNaN(start.getTime()) || !(end instanceof Date) || isNaN(end.getTime())) {
    throw new UserError('Rango de fechas inválido')
  }
  if (start > end) {
    throw new UserError('La fecha de inicio debe ser anterior a la fecha de término')
  }
  const timezone = business.timezone || 'America/Santiago'
  return getEffectiveBlocks(businessId, start, end, timezone)
}

async function _deleteTimeBlock(id: string) {
  const { businessId } = await requireBusinessRole(['owner', 'admin'])
  const limit = await checkRateLimit('delete-timeblock', 20, 60000)
  if (!limit.success) {
    throw new UserError('Demasiadas solicitudes. Intenta de nuevo en unos minutos.')
  }

  const deleteResult = await prisma.timeBlock.deleteMany({
    where: { id, businessId },
  })
  if (deleteResult.count === 0) {
    throw new ForbiddenError('Bloque no encontrado')
  }

  revalidatePath('/dashboard/availability')
  revalidatePath('/dashboard/calendar')
  await revalidateBusinessPublicPaths(businessId)
}

export const deleteTimeBlock = action(_deleteTimeBlock)

async function _updateTimeBlock(
  id: string,
  data: Omit<TimeBlock, 'id' | 'createdAt' | 'businessId' | 'overlapToleranceMinutes'> & { overlapToleranceMinutes?: number; confirmOverlap?: boolean },
): Promise<TimeBlock | { requiresConfirmation: true; message: string }> {
  const { businessId, business } = await requireBusinessRole(['owner', 'admin'])
  const limit = await checkRateLimit('update-timeblock', 20, 60000)
  if (!limit.success) {
    throw new UserError('Demasiadas solicitudes. Intenta de nuevo en unos minutos.')
  }

  const parsed = createTimeBlockSchema.safeParse(data)
  if (!parsed.success) {
    throw new UserError('Datos inválidos: ' + parsed.error.issues.map(i => i.message).join(', '))
  }
  const { startDateTime, endDateTime, reason, overlapToleranceMinutes, confirmOverlap } = parsed.data

  const durationMs = differenceInMilliseconds(endDateTime, startDateTime)
  if (durationMs > MAX_BLOCK_DURATION_MS) {
    throw new UserError('La duración máxima de un bloqueo es de 32 días')
  }

  const existing = await prisma.timeBlock.findFirst({
    where: { id, businessId },
  })
  if (!existing) {
    throw new ForbiddenError('Bloque no encontrado')
  }

  const timeChanged =
    existing.startDateTime.getTime() !== startDateTime.getTime() ||
    existing.endDateTime.getTime() !== endDateTime.getTime()

  if (timeChanged) {
    const now = new Date()
    const overlappingBookings = await prisma.booking.findMany({
      where: overlappingActiveBookingsWhere(businessId, startDateTime, endDateTime, now),
      select: { id: true },
      take: 1,
    })

    if (overlappingBookings.length > 0 && confirmOverlap !== true) {
      const timezone = business.timezone || 'America/Santiago'
      // El bloqueo editado se excluye del "antes": lo que importa es el efecto
      // de su nuevo horario, no el del horario que se está reemplazando.
      const addendum = await serviceFitAddendum(
        businessId,
        timezone,
        [{ startDateTime, endDateTime }],
        now,
        (b) => b.id === id,
      )
      return {
        requiresConfirmation: true as const,
        message:
          'El bloqueo se solapa con reservas existentes. ' +
          'Marca la casilla de confirmación si deseas guardarlo de todas formas ' +
          '(no se cancelarán las reservas existentes).' +
          addendum,
      }
    }
  }

  const updateResult = await prisma.timeBlock.updateMany({
    where: { id, businessId },
    data: { startDateTime, endDateTime, reason, overlapToleranceMinutes },
  })
  if (updateResult.count === 0) {
    throw new ForbiddenError('Bloque no encontrado')
  }

  revalidatePath('/dashboard/availability')
  revalidatePath('/dashboard/calendar')
  await revalidateBusinessPublicPaths(businessId)

  return { ...existing, startDateTime, endDateTime, reason }
}

export const updateTimeBlock = action(_updateTimeBlock)

const createSeriesSchema = z.object({
  daysOfWeek: z.array(z.number().int().min(0).max(6)).min(1, 'Selecciona al menos un día'),
  startTime: z.string().regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/),
  endTime: z.string().regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/),
  reason: z.string().max(255).optional().nullable(),
  anchorDate: z.date(),
  endMode: z.enum(['forever', 'month', 'weeks']),
  weeks: z.number().int().min(1).max(52).optional().nullable(),
  overlapToleranceMinutes: z.number().int().min(0).max(240).optional(),
}).refine((d) => d.endTime > d.startTime, { message: 'La hora de fin debe ser posterior a la de inicio' })
  .refine((d) => (d.overlapToleranceMinutes ?? 0) <= (timeToMinutes(d.endTime) - timeToMinutes(d.startTime)) / 2, {
    message: TOLERANCE_TOO_BIG_MESSAGE,
  })

async function _createTimeBlockSeries(data: {
  daysOfWeek: number[]
  startTime: string
  endTime: string
  reason?: string | null
  anchorDate: Date
  endMode: SeriesEndMode
  weeks?: number | null
  overlapToleranceMinutes?: number
  confirmed?: boolean
}): Promise<
  | { requiresConfirmation: true; message: string }
  | { series: TimeBlockSeries; overlappingDates: string[] }
> {
  const { businessId, business } = await requireBusinessRole(['owner', 'admin'])
  await rateLimitOrThrow('create-timeblock')

  const parsed = createSeriesSchema.safeParse(data)
  if (!parsed.success) {
    throw new UserError('Datos inválidos: ' + parsed.error.issues.map((i) => i.message).join(', '))
  }

  const timezone = business.timezone || 'America/Santiago'

  const until = computeSeriesUntil(data.anchorDate, data.endMode, data.weeks ?? null, timezone)

  // Chequeo ANTES de crear: ocurrencias de la serie propuesta vs reservas
  // activas dentro de la ventana de reserva del negocio. Si hay conflicto y no
  // viene confirmación, NO se crea nada.
  const now = new Date()
  const { occurrences, overlappingDates } = await findSeriesBookingConflicts(
    businessId,
    { id: 'proposed', daysOfWeek: data.daysOfWeek, startTime: data.startTime, endTime: data.endTime, reason: data.reason ?? null, anchorDate: data.anchorDate, until },
    timezone,
    now,
    business.bookingWindowDays ?? 90,
  )

  if (overlappingDates.length > 0 && data.confirmed !== true) {
    const addendum = await serviceFitAddendum(businessId, timezone, occurrences, now)
    return {
      requiresConfirmation: true as const,
      message: buildSeriesConflictMessage(
        'El bloqueo recurrente',
        overlappingDates,
        'Marca la casilla de confirmación si deseas crearlo de todas formas',
        addendum,
      ),
    }
  }

  const series = await prisma.timeBlockSeries.create({
    data: {
      businessId,
      daysOfWeek: data.daysOfWeek,
      startTime: data.startTime,
      endTime: data.endTime,
      reason: data.reason ?? null,
      anchorDate: data.anchorDate,
      until,
      overlapToleranceMinutes: data.overlapToleranceMinutes ?? 0,
    },
  })

  await revalidateTimeBlocks(businessId)

  return { series, overlappingDates }
}

export const createTimeBlockSeries = action(_createTimeBlockSeries)

async function assertSeriesOwned(seriesId: string, businessId: string) {
  const series = await prisma.timeBlockSeries.findFirst({ where: { id: seriesId, businessId } })
  if (!series) throw new ForbiddenError('Serie no encontrada')
  return series
}

async function _skipSeriesOccurrence(seriesId: string, occurrenceDate: Date) {
  const { businessId } = await requireBusinessRole(['owner', 'admin'])
  await rateLimitOrThrow('update-timeblock')
  await assertSeriesOwned(seriesId, businessId)

  await prisma.timeBlockException.upsert({
    where: { seriesId_occurrenceDate: { seriesId, occurrenceDate } },
    create: { seriesId, occurrenceDate, isSkipped: true },
    update: { isSkipped: true, startDateTime: null, endDateTime: null, reason: null },
  })

  await revalidateTimeBlocks(businessId)
}

export const skipSeriesOccurrence = action(_skipSeriesOccurrence)

async function _updateTimeBlockSeries(
  seriesId: string,
  changes: { startTime: string; endTime: string; reason?: string | null; confirmed?: boolean },
): Promise<{ requiresConfirmation: true; message: string } | { series: TimeBlockSeries }> {
  const { businessId, business } = await requireBusinessRole(['owner', 'admin'])
  await rateLimitOrThrow('update-timeblock')

  const timeRe = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/
  if (!timeRe.test(changes.startTime) || !timeRe.test(changes.endTime) || changes.endTime <= changes.startTime) {
    throw new UserError('Datos inválidos: la hora de fin debe ser posterior a la de inicio')
  }

  const existing = await assertSeriesOwned(seriesId, businessId)
  const timezone = business.timezone || 'America/Santiago'

  const now = new Date()
  const todayStr = formatInTimeZone(now, timezone, 'yyyy-MM-dd')
  const yesterdayStr = formatInTimeZone(addDays(now, -1), timezone, 'yyyy-MM-dd')
  const oldUntil = fromZonedTime(`${yesterdayStr} 00:00:00`, timezone)
  const anchorToday = fromZonedTime(`${todayStr} 00:00:00`, timezone)

  // Partir la serie solo cuando conviene conservar el historial (hay pasado Y
  // futuro). Si es solo-futura o ya terminó, editar en el lugar: el split
  // crearía una serie fantasma con anchor>until que no se renderiza (bug real).
  const anchorStr = getLocalDateStr(existing.anchorDate, timezone)
  const untilStr = existing.until ? getLocalDateStr(existing.until, timezone) : null
  const { mode, hasFuture } = planSeriesUpdate(anchorStr, untilStr, todayStr, yesterdayStr)

  // Chequeo ANTES de guardar: ocurrencias que TOMARÁN el horario nuevo (de hoy en
  // adelante) vs reservas activas. En split arrancan hoy; in-place solo-futura
  // arrancan en su propio anchor (>= hoy). Sin futuro no hay nada que chequear.
  if (hasFuture) {
    const futureAnchor = mode === 'split' ? anchorToday : existing.anchorDate
    const { occurrences, overlappingDates } = await findSeriesBookingConflicts(
      businessId,
      { id: 'proposed', daysOfWeek: existing.daysOfWeek, startTime: changes.startTime, endTime: changes.endTime, reason: changes.reason ?? null, anchorDate: futureAnchor, until: existing.until },
      timezone,
      now,
      business.bookingWindowDays ?? 90,
    )

    if (overlappingDates.length > 0 && changes.confirmed !== true) {
      // La serie original se excluye del "antes": su horario será reemplazado.
      const addendum = await serviceFitAddendum(businessId, timezone, occurrences, now, (b) => b.seriesId === seriesId)
      return {
        requiresConfirmation: true as const,
        message: buildSeriesConflictMessage(
          'El nuevo horario de la serie',
          overlappingDates,
          'Confirma si deseas guardarlo de todas formas',
          addendum,
        ),
      }
    }
  }

  if (mode === 'in-place') {
    // Cambia el registro directamente (conserva días, anchor, until, tolerancia).
    // Misma id → la UI re-renderiza el horario nuevo al refrescar. Restablece las
    // ocurrencias editadas individualmente de hoy en adelante (igual que el split).
    const [, updated] = await prisma.$transaction([
      prisma.timeBlockException.deleteMany({ where: { seriesId, occurrenceDate: { gte: anchorToday } } }),
      prisma.timeBlockSeries.update({
        where: { id: seriesId },
        data: { startTime: changes.startTime, endTime: changes.endTime, reason: changes.reason ?? null },
      }),
    ])
    await revalidateTimeBlocks(businessId)
    return { series: updated }
  }

  // Split en hoy: la serie vieja termina AYER (inclusivo), la nueva arranca hoy y
  // CONSERVA el patrón de días y la fecha de fin (until) originales — el diálogo de
  // edición solo cambia hora/motivo. Reset de excepciones futuras (viven en la vieja).
  const [, newSeries] = await prisma.$transaction([
    prisma.timeBlockSeries.update({ where: { id: seriesId }, data: { until: oldUntil, isActive: existing.anchorDate <= oldUntil } }),
    prisma.timeBlockSeries.create({
      data: {
        businessId,
        daysOfWeek: existing.daysOfWeek,
        startTime: changes.startTime,
        endTime: changes.endTime,
        reason: changes.reason ?? null,
        anchorDate: anchorToday,
        until: existing.until,
        // La tolerancia es de la serie y el diálogo no la edita: se conserva
        overlapToleranceMinutes: existing.overlapToleranceMinutes ?? 0,
      },
    }),
  ])

  await revalidateTimeBlocks(businessId)

  return { series: newSeries }
}

export const updateTimeBlockSeries = action(_updateTimeBlockSeries)

async function _deleteTimeBlockSeries(seriesId: string) {
  const { businessId } = await requireBusinessRole(['owner', 'admin'])
  await rateLimitOrThrow('delete-timeblock')
  await assertSeriesOwned(seriesId, businessId)

  // onDelete: Cascade en TimeBlockException borra las excepciones.
  await prisma.timeBlockSeries.delete({ where: { id: seriesId } })

  await revalidateTimeBlocks(businessId)
}

export const deleteTimeBlockSeries = action(_deleteTimeBlockSeries)

export async function getTimeBlockSeries() {
  const { businessId } = await requireBusiness()
  return prisma.timeBlockSeries.findMany({
    where: { businessId, isActive: true, OR: [{ until: null }, { until: { gte: new Date() } }] },
    orderBy: { createdAt: 'desc' },
  })
}

async function _overrideSeriesOccurrence(
  seriesId: string,
  occurrenceDate: Date,
  data: { startDateTime: Date; endDateTime: Date; reason?: string | null; confirmed?: boolean },
): Promise<{ requiresConfirmation: true; message: string } | undefined> {
  const { businessId, business } = await requireBusinessRole(['owner', 'admin'])
  await rateLimitOrThrow('update-timeblock')
  if (data.endDateTime <= data.startDateTime) throw new UserError('La hora de fin debe ser posterior a la de inicio')
  await assertSeriesOwned(seriesId, businessId)

  // Mismo patrón requiresConfirmation que los bloqueos sueltos: el nuevo rango
  // del día no debe pisar reservas activas sin confirmación explícita.
  const now = new Date()
  const overlappingBookings = await prisma.booking.findMany({
    where: overlappingActiveBookingsWhere(businessId, data.startDateTime, data.endDateTime, now),
    select: { id: true },
    take: 1,
  })

  if (overlappingBookings.length > 0 && data.confirmed !== true) {
    const timezone = business.timezone || 'America/Santiago'
    // La ocurrencia original de ese día se excluye del "antes": será reemplazada.
    const addendum = await serviceFitAddendum(
      businessId,
      timezone,
      [{ startDateTime: data.startDateTime, endDateTime: data.endDateTime }],
      now,
      (b) =>
        b.seriesId === seriesId &&
        b.occurrenceDate != null &&
        getLocalDateStr(b.occurrenceDate, timezone) === getLocalDateStr(occurrenceDate, timezone),
    )
    return {
      requiresConfirmation: true as const,
      message:
        'El bloqueo se solapa con reservas existentes. ' +
        'Confirma si deseas guardarlo de todas formas (no se cancelarán las reservas existentes).' +
        addendum,
    }
  }

  await prisma.timeBlockException.upsert({
    where: { seriesId_occurrenceDate: { seriesId, occurrenceDate } },
    create: { seriesId, occurrenceDate, isSkipped: false, startDateTime: data.startDateTime, endDateTime: data.endDateTime, reason: data.reason ?? null },
    update: { isSkipped: false, startDateTime: data.startDateTime, endDateTime: data.endDateTime, reason: data.reason ?? null },
  })

  await revalidateTimeBlocks(businessId)
}

export const overrideSeriesOccurrence = action(_overrideSeriesOccurrence)
