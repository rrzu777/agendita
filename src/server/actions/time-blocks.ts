'use server'

import { z } from 'zod'
import { prisma } from '@/lib/db'
import type { Prisma, TimeBlock, TimeBlockSeries } from '@prisma/client'
import { revalidatePath } from 'next/cache'
import { checkRateLimit } from '@/lib/rate-limit'
import { revalidateBusinessPublicPaths } from './revalidate-business'
import { requireBusiness, requireBusinessRole, ForbiddenError } from '@/lib/auth/server'
import { differenceInMilliseconds, addDays } from 'date-fns'
import { getEffectiveBlocks, type EffectiveBlock } from '@/lib/availability/effective-blocks'
import { computeServiceFit } from '@/lib/availability/service-fit'
import { getLocalDateStr } from '@/lib/availability/timezone'
import { computeSeriesUntil, expandSeries, type SeriesEndMode } from '@/lib/calendar/expand-series'
import { timeToMinutes } from '@/lib/availability/time-range'
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz'

const MAX_BLOCK_DURATION_MS = 32 * 24 * 60 * 60 * 1000 // 32 dias

// Días hacia adelante que se inspeccionan al buscar reservas que chocan con
// las ocurrencias de una serie propuesta (crear/editar serie completa).
const SERIES_CONFLICT_WINDOW_DAYS = 60

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

    let blocks = await getEffectiveBlocks(businessId, now, addDays(now, 8), timezone)
    if (excludeBlock) blocks = blocks.filter((b) => !excludeBlock(b))

    const before = computeServiceFit(services, rules, blocks, timezone, now)
    const after = computeServiceFit(services, rules, [...blocks, ...proposedBlocks], timezone, now)

    return after
      .filter((a) => a.fitsNowhere && before.some((b) => b.serviceId === a.serviceId && !b.fitsNowhere))
      .map((s) => ` Además, con este bloqueo "${s.serviceName}" no cabría en ningún día.`)
      .join('')
  } catch {
    return ''
  }
}

const TOLERANCE_TOO_BIG_MESSAGE = 'La tolerancia no puede superar la mitad de la duración del bloqueo'

const createTimeBlockSchema = z.object({
  startDateTime: z.date(),
  endDateTime: z.date(),
  reason: z.string().max(255).optional().nullable(),
  overlapToleranceMinutes: z.number().int().min(0).max(240).optional(),
  confirmOverlap: z.boolean().optional(),
}).refine(data => data.endDateTime > data.startDateTime, {
  message: 'La fecha de fin debe ser posterior a la de inicio',
}).refine(data => {
  const tolerance = data.overlapToleranceMinutes ?? 0
  const durationMinutes = (data.endDateTime.getTime() - data.startDateTime.getTime()) / 60_000
  return tolerance <= durationMinutes / 2
}, { message: TOLERANCE_TOO_BIG_MESSAGE })

function parseTimeBlockInput(raw: Record<string, unknown>): { startDateTime: Date; endDateTime: Date; reason: string | null; overlapToleranceMinutes: number; confirmOverlap: boolean } {
  const startDateTime = raw.startDateTime instanceof Date ? raw.startDateTime : new Date(raw.startDateTime as string)
  const endDateTime = raw.endDateTime instanceof Date ? raw.endDateTime : new Date(raw.endDateTime as string)
  const reason = typeof raw.reason === 'string' ? raw.reason : null
  const overlapToleranceMinutes = typeof raw.overlapToleranceMinutes === 'number' ? raw.overlapToleranceMinutes : 0
  const confirmOverlap = raw.confirmOverlap === true
  return { startDateTime, endDateTime, reason, overlapToleranceMinutes, confirmOverlap }
}

async function rateLimitOrThrow(key: string) {
  const limit = await checkRateLimit(key, 20, 60000)
  if (!limit.success) throw new Error('Demasiadas solicitudes. Intenta de nuevo en unos minutos.')
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

export async function createTimeBlock(data: Omit<TimeBlock, 'id' | 'createdAt' | 'businessId' | 'overlapToleranceMinutes'> & { overlapToleranceMinutes?: number; confirmOverlap?: boolean }) {
  const { businessId, business } = await requireBusinessRole(['owner', 'admin'])
  const limit = await checkRateLimit('create-timeblock', 20, 60000)
  if (!limit.success) {
    throw new Error('Demasiadas solicitudes. Intenta de nuevo en unos minutos.')
  }

  const raw = data as unknown as Record<string, unknown>
  const { startDateTime, endDateTime, reason, overlapToleranceMinutes, confirmOverlap } = parseTimeBlockInput(raw)

  const parsed = createTimeBlockSchema.safeParse({ startDateTime, endDateTime, reason, overlapToleranceMinutes, confirmOverlap })
  if (!parsed.success) {
    throw new Error('Datos inválidos: ' + parsed.error.issues.map(i => i.message).join(', '))
  }

  const durationMs = differenceInMilliseconds(endDateTime, startDateTime)
  if (durationMs > MAX_BLOCK_DURATION_MS) {
    throw new Error('La duración máxima de un bloqueo es de 32 días')
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

export async function getTimeBlocksByRange(start: Date, end: Date) {
  const { businessId, business } = await requireBusiness()
  if (!(start instanceof Date) || isNaN(start.getTime()) || !(end instanceof Date) || isNaN(end.getTime())) {
    throw new Error('Rango de fechas inválido')
  }
  if (start > end) {
    throw new Error('La fecha de inicio debe ser anterior a la fecha de término')
  }
  const timezone = business.timezone || 'America/Santiago'
  return getEffectiveBlocks(businessId, start, end, timezone)
}

export async function deleteTimeBlock(id: string) {
  const { businessId } = await requireBusinessRole(['owner', 'admin'])
  const limit = await checkRateLimit('delete-timeblock', 20, 60000)
  if (!limit.success) {
    throw new Error('Demasiadas solicitudes. Intenta de nuevo en unos minutos.')
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

export async function updateTimeBlock(
  id: string,
  data: Omit<TimeBlock, 'id' | 'createdAt' | 'businessId' | 'overlapToleranceMinutes'> & { overlapToleranceMinutes?: number; confirmOverlap?: boolean },
): Promise<TimeBlock | { requiresConfirmation: true; message: string }> {
  const { businessId, business } = await requireBusinessRole(['owner', 'admin'])
  const limit = await checkRateLimit('update-timeblock', 20, 60000)
  if (!limit.success) {
    throw new Error('Demasiadas solicitudes. Intenta de nuevo en unos minutos.')
  }

  const raw = data as unknown as Record<string, unknown>
  const { startDateTime, endDateTime, reason, overlapToleranceMinutes, confirmOverlap } = parseTimeBlockInput(raw)

  const parsed = createTimeBlockSchema.safeParse({ startDateTime, endDateTime, reason, overlapToleranceMinutes, confirmOverlap })
  if (!parsed.success) {
    throw new Error('Datos inválidos: ' + parsed.error.issues.map(i => i.message).join(', '))
  }

  const durationMs = differenceInMilliseconds(endDateTime, startDateTime)
  if (durationMs > MAX_BLOCK_DURATION_MS) {
    throw new Error('La duración máxima de un bloqueo es de 32 días')
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

export async function createTimeBlockSeries(data: {
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
    throw new Error('Datos inválidos: ' + parsed.error.issues.map((i) => i.message).join(', '))
  }

  const timezone = business.timezone || 'America/Santiago'

  const until = computeSeriesUntil(data.anchorDate, data.endMode, data.weeks ?? null, timezone)

  // Chequeo ANTES de crear: se expanden las ocurrencias de la serie propuesta
  // para los próximos días y se buscan reservas activas que solapen. Si hay y
  // no viene confirmación, NO se crea nada.
  const now = new Date()
  const checkEnd = addDays(now, SERIES_CONFLICT_WINDOW_DAYS)
  const proposed = {
    id: 'proposed',
    daysOfWeek: data.daysOfWeek,
    startTime: data.startTime,
    endTime: data.endTime,
    reason: data.reason ?? null,
    anchorDate: data.anchorDate,
    until,
  }
  const occurrences = expandSeries(proposed, [], now, checkEnd, timezone)
  const bookings = await prisma.booking.findMany({
    where: overlappingActiveBookingsWhere(businessId, now, checkEnd, now),
    select: { startDateTime: true, endDateTime: true },
  })
  const overlappingDates = Array.from(
    new Set(
      occurrences
        .filter((occ) => bookings.some((b) => occ.startDateTime < b.endDateTime && b.startDateTime < occ.endDateTime))
        .map((occ) => formatInTimeZone(occ.startDateTime, timezone, 'yyyy-MM-dd')),
    ),
  )

  if (overlappingDates.length > 0 && data.confirmed !== true) {
    const firstDates = overlappingDates.slice(0, 3).join(', ')
    const suffix = overlappingDates.length > 3 ? ', …' : ''
    const addendum = await serviceFitAddendum(businessId, timezone, occurrences, now)
    return {
      requiresConfirmation: true as const,
      message:
        `El bloqueo recurrente se solapa con reservas existentes en ${overlappingDates.length} ` +
        `día(s): ${firstDates}${suffix}. ` +
        'Marca la casilla de confirmación si deseas crearlo de todas formas ' +
        '(no se cancelarán las reservas existentes).' +
        addendum,
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

async function assertSeriesOwned(seriesId: string, businessId: string) {
  const series = await prisma.timeBlockSeries.findFirst({ where: { id: seriesId, businessId } })
  if (!series) throw new ForbiddenError('Serie no encontrada')
  return series
}

export async function skipSeriesOccurrence(seriesId: string, occurrenceDate: Date) {
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

export async function updateTimeBlockSeries(
  seriesId: string,
  changes: { startTime: string; endTime: string; reason?: string | null; confirmed?: boolean },
): Promise<{ requiresConfirmation: true; message: string } | { series: TimeBlockSeries }> {
  const { businessId, business } = await requireBusinessRole(['owner', 'admin'])
  await rateLimitOrThrow('update-timeblock')

  const timeRe = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/
  if (!timeRe.test(changes.startTime) || !timeRe.test(changes.endTime) || changes.endTime <= changes.startTime) {
    throw new Error('Datos inválidos: la hora de fin debe ser posterior a la de inicio')
  }

  const existing = await assertSeriesOwned(seriesId, businessId)
  const timezone = business.timezone || 'America/Santiago'

  // Split en hoy: la serie vieja termina AYER (inclusivo), la nueva arranca hoy y
  // CONSERVA el patrón de días y la fecha de fin (until) originales — el diálogo de
  // edición solo cambia hora/motivo. Reset de excepciones futuras (viven en la vieja).
  const now = new Date()
  const todayStr = formatInTimeZone(now, timezone, 'yyyy-MM-dd')
  const yesterdayStr = formatInTimeZone(addDays(now, -1), timezone, 'yyyy-MM-dd')
  const oldUntil = fromZonedTime(`${yesterdayStr} 00:00:00`, timezone)
  const anchorToday = fromZonedTime(`${todayStr} 00:00:00`, timezone)

  // Chequeo ANTES de guardar: ocurrencias futuras del NUEVO horario vs
  // reservas activas. Mismo patrón requiresConfirmation que los bloqueos sueltos.
  const checkEnd = addDays(now, SERIES_CONFLICT_WINDOW_DAYS)
  const proposed = {
    id: 'proposed',
    daysOfWeek: existing.daysOfWeek,
    startTime: changes.startTime,
    endTime: changes.endTime,
    reason: changes.reason ?? null,
    anchorDate: anchorToday,
    until: existing.until,
  }
  const occurrences = expandSeries(proposed, [], now, checkEnd, timezone)
  const bookings = await prisma.booking.findMany({
    where: overlappingActiveBookingsWhere(businessId, now, checkEnd, now),
    select: { startDateTime: true, endDateTime: true },
  })
  const overlappingDates = Array.from(
    new Set(
      occurrences
        .filter((occ) => bookings.some((b) => occ.startDateTime < b.endDateTime && b.startDateTime < occ.endDateTime))
        .map((occ) => formatInTimeZone(occ.startDateTime, timezone, 'yyyy-MM-dd')),
    ),
  )

  if (overlappingDates.length > 0 && changes.confirmed !== true) {
    const firstDates = overlappingDates.slice(0, 3).join(', ')
    const suffix = overlappingDates.length > 3 ? ', …' : ''
    // La serie original se excluye del "antes": su horario será reemplazado.
    const addendum = await serviceFitAddendum(businessId, timezone, occurrences, now, (b) => b.seriesId === seriesId)
    return {
      requiresConfirmation: true as const,
      message:
        `El nuevo horario de la serie se solapa con reservas existentes en ${overlappingDates.length} ` +
        `día(s): ${firstDates}${suffix}. ` +
        'Confirma si deseas guardarlo de todas formas (no se cancelarán las reservas existentes).' +
        addendum,
    }
  }

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

export async function deleteTimeBlockSeries(seriesId: string) {
  const { businessId } = await requireBusinessRole(['owner', 'admin'])
  await rateLimitOrThrow('delete-timeblock')
  await assertSeriesOwned(seriesId, businessId)

  // onDelete: Cascade en TimeBlockException borra las excepciones.
  await prisma.timeBlockSeries.delete({ where: { id: seriesId } })

  await revalidateTimeBlocks(businessId)
}

export async function getTimeBlockSeries() {
  const { businessId } = await requireBusiness()
  return prisma.timeBlockSeries.findMany({
    where: { businessId, isActive: true, OR: [{ until: null }, { until: { gte: new Date() } }] },
    orderBy: { createdAt: 'desc' },
  })
}

export async function overrideSeriesOccurrence(
  seriesId: string,
  occurrenceDate: Date,
  data: { startDateTime: Date; endDateTime: Date; reason?: string | null; confirmed?: boolean },
): Promise<{ requiresConfirmation: true; message: string } | undefined> {
  const { businessId, business } = await requireBusinessRole(['owner', 'admin'])
  await rateLimitOrThrow('update-timeblock')
  if (data.endDateTime <= data.startDateTime) throw new Error('La hora de fin debe ser posterior a la de inicio')
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
