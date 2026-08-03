'use server'

import { z } from 'zod'
import { prisma } from '@/lib/db'
import { BookingStatus, BookingPaymentStatus, type Prisma, type TimeBlock, type TimeBlockSeries } from '@prisma/client'
import { revalidatePath } from 'next/cache'
import { checkRateLimit } from '@/lib/rate-limit'
import { revalidateBusinessPublicPaths } from './revalidate-business'
import { requireBusiness, requireBusinessRole, ForbiddenError } from '@/lib/auth/server'
import { action, UserError } from '@/lib/actions/result'
import { differenceInMilliseconds, addDays } from 'date-fns'
import { getEffectiveBlocks, type EffectiveBlock } from '@/lib/availability/effective-blocks'
import { computeServiceFit, SERVICE_FIT_WINDOW_DAYS } from '@/lib/availability/service-fit'
import { blockScopeCondition, blockScopeFor, bookingScopeCondition, resolveAvailabilityRules } from '@/lib/availability/scope'
import { assertOwnerScope } from '@/lib/professionals/ownership'
import { getLocalDateStr, startOfLocalDay } from '@/lib/availability/timezone'
import { computeSeriesUntil, expandSeries, type SeriesEndMode } from '@/lib/calendar/expand-series'
import { planSeriesUpdate } from '@/lib/calendar/series-update-plan'
import { timeToMinutes } from '@/lib/availability/time-range'
import { OCCUPYING_STATUSES } from '@/lib/bookings/approval'
import { BANK_TRANSFER_METHOD } from '@/lib/bank-transfer/declared'
import { MANUAL_COORDINATION_METHOD } from '@/lib/bookings/hold'
import { formatInTimeZone } from 'date-fns-tz'

const MAX_BLOCK_DURATION_MS = 32 * 24 * 60 * 60 * 1000 // 32 dias


/**
 * Filtro de reservas activas que solapan [start, end]. Es `occupiesSlot`
 * (lib/bookings/approval.ts) escrito como where de Prisma — un where no puede
 * llamar a una función, así que la regla vive dos veces y ese módulo es la fuente:
 * un hold DE PAGO vencido libera el cupo, salvo los que ningún sweep va a barrer
 * (con plata encima o con transferencia bancaria de por medio), que siguen tapando
 * porque para el EXCLUDE `Booking_no_overlap` siguen ocupando el horario. Los
 * demás estados activos tapan siempre y salen de `OCCUPYING_STATUSES`.
 *
 * `professionalId` es de QUIÉN es el bloqueo que se está creando, no de la reserva:
 * un bloqueo del salón choca contra todas las citas, y el de una persona sólo contra
 * las suyas y las que no tienen dueño. **Acá está la palanca**, no en el literal de
 * la serie propuesta: sin este parámetro, crear el almuerzo recurrente de Juan avisa
 * "se solapa con reservas en 12 día(s)" por las citas de Ana, la dueña aprende a
 * tildar "confirmar" siempre y el aviso deja de significar algo.
 *
 * `AND` y no spread: el `OR` de los estados ya ocupa ese nivel.
 */
function overlappingActiveBookingsWhere(
  businessId: string,
  start: Date,
  end: Date,
  now: Date,
  professionalId: string | null,
): Prisma.BookingWhereInput {
  const holdAliveOr = [{ holdExpiresAt: null }, { holdExpiresAt: { gt: now } }]
  return {
    businessId,
    startDateTime: { lt: end },
    endDateTime: { gt: start },
    OR: [
      { status: { in: [...OCCUPYING_STATUSES] } },
      {
        status: BookingStatus.pending_payment,
        OR: [
          ...holdAliveOr,
          { paymentStatus: { not: BookingPaymentStatus.unpaid } },
          // Transferencia y coordinación manual siguen bloqueando con el hold
          // muerto: su email de expiración promete que el negocio puede
          // reactivarlas, y un bloqueo encima haría chocar ese revive.
          { paymentMethod: { in: [BANK_TRANSFER_METHOD, MANUAL_COORDINATION_METHOD] } },
        ],
      },
    ],
    AND: bookingScopeCondition(professionalId),
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
    where: overlappingActiveBookingsWhere(businessId, now, checkEnd, now, proposed.professionalId),
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
 *
 * Parámetros con nombre y no posicionales: `timezone` y `professionalId` son los dos
 * `string` y cambiarlos de lugar compila. Es la misma razón por la que
 * `getEffectiveBlocks` toma un objeto.
 */
async function serviceFitAddendum({
  businessId,
  timezone,
  proposedBlocks,
  now,
  professionalId,
  excludeBlock,
}: {
  businessId: string
  timezone: string
  proposedBlocks: { startDateTime: Date; endDateTime: Date }[]
  now: Date
  /** De quién es el bloqueo propuesto. El aviso se simula contra SU horario. */
  professionalId: string | null
  excludeBlock?: (block: EffectiveBlock) => boolean
}): Promise<string> {
  try {
    const [services, rules] = await Promise.all([
      prisma.service.findMany({ where: { businessId, isActive: true } }),
      // Por `resolveAvailabilityRules` y no un findMany crudo: es el mismo
      // `computeServiceFit` que la pantalla de Disponibilidad, y ahí las reglas ya
      // vienen con alcance. Sin esto, el aviso sobre el bloqueo de una persona
      // simularía el fit con los horarios de todo el equipo mezclados y daría una
      // respuesta distinta a la de la pantalla sobre exactamente lo mismo.
      resolveAvailabilityRules(prisma, businessId, professionalId),
    ])
    if (services.length === 0 || rules.length === 0) return ''

    const fitWindowEnd = addDays(now, SERVICE_FIT_WINDOW_DAYS + 1)
    // El mismo alcance que las reglas, en la otra punta del cálculo: el aviso sobre
    // las vacaciones de Juan no puede contar el franco de Ana como si le cerrara el
    // día a Juan.
    let blocks = await getEffectiveBlocks({
      businessId,
      rangeStart: now,
      rangeEnd: fitWindowEnd,
      timezone,
      scope: blockScopeFor(professionalId),
    })
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

/**
 * Los bloqueos que le tapan la agenda a esta persona (o al negocio), para la lista de
 * la pantalla de disponibilidad.
 *
 * El alcance es el MISMO que usa el cálculo de slots (`blockScopeFor`), y eso es lo
 * que hace que la lista sea una explicación de la agenda y no una tabla aparte: con
 * una persona elegida se ven los suyos **más** los del negocio, que son justamente los
 * dos que la dejan sin atender. Con el negocio elegido se ven sólo los del negocio —
 * las vacaciones de una persona no cierran el local, así que listarlas ahí diría que
 * cierran.
 *
 * Trae el nombre del dueño en el mismo viaje, y no lo cruza contra la lista de gente
 * activa que ya tiene la página, porque los bloqueos de alguien **en pausa** siguen
 * existiendo: cruzando contra los activos quedarían sin nombre justo los que la dueña
 * no puede explicarse.
 */
export async function getTimeBlocks(professionalId: string | null = null) {
  const { businessId } = await requireBusiness()
  const owner = await assertOwnerScope(prisma, businessId, professionalId)
  return prisma.timeBlock.findMany({
    where: { businessId, AND: blockScopeCondition(blockScopeFor(owner)) },
    include: { professional: { select: { name: true } } },
    orderBy: { startDateTime: 'asc' },
  })
}

/**
 * La entrada de un bloqueo. `professionalId` **sale del modelo** (el tipo generado ya
 * es `string | null`, nunca `undefined`) y por eso deja de estar en el `Omit`: acá se
 * lo quiere obligatorio, que es exactamente lo que da no omitirlo. Los otros cuatro
 * siguen omitidos porque son de la fila, no de la entrada.
 *
 * Que sea obligatorio es lo que fuerza a cada caller a decidir de quién es el bloqueo.
 * Un `undefined` que igual se cuele desde el navegador cae en "del salón"
 * (`assertOwnerScope` normaliza), que es el lado conservador: choca contra todo en vez
 * de contra nada.
 */
type TimeBlockInput = Omit<TimeBlock, 'id' | 'createdAt' | 'businessId' | 'overlapToleranceMinutes'> & {
  overlapToleranceMinutes?: number
  confirmOverlap?: boolean
}

async function _createTimeBlock(data: TimeBlockInput) {
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

  const professionalId = await assertOwnerScope(prisma, businessId, data.professionalId)

  const now = new Date()
  const overlappingBookings = await prisma.booking.findMany({
    where: overlappingActiveBookingsWhere(businessId, startDateTime, endDateTime, now, professionalId),
    select: { id: true },
    take: 1,
  })

  if (overlappingBookings.length > 0 && confirmOverlap !== true) {
    // No es un error: es un estado "requiere confirmación". Devolvemos un
    // resultado estructurado en lugar de lanzar, para no generar un 500 (y su
    // ruido en los logs) en un flujo de validación esperado.
    const timezone = business.timezone || 'America/Santiago'
    const addendum = await serviceFitAddendum({
      businessId,
      timezone,
      proposedBlocks: [{ startDateTime, endDateTime }],
      now,
      professionalId,
    })
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
    data: { startDateTime, endDateTime, reason, overlapToleranceMinutes, businessId, professionalId },
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
  // `everyone` y no `business`: esto alimenta el calendario del panel, que es una
  // pantalla para MOSTRAR. La dueña tiene que ver las vacaciones de cada persona
  // igual que el feriado del salón; filtrarlas acá las volvería invisibles y
  // parecería que el bloqueo no se guardó.
  //
  // OJO hasta dónde llega el dueño del bloqueo: `EffectiveBlock.professionalId` sale
  // de acá, pero `dashboard/calendar/page.tsx` serializa campo por campo y NO lo
  // pasa, así que hoy el calendario dibuja igual un feriado del salón y las
  // vacaciones de una persona. Serializarlo y distinguirlos es del PR del panel — la
  // plomería NO está hecha, no asumir que alcanza con leerlo.
  return getEffectiveBlocks({ businessId, rangeStart: start, rangeEnd: end, timezone, scope: { kind: 'everyone' } })
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

// Sin `professionalId` en la entrada, a diferencia de crear: editar hora y motivo no
// cambia de quién es el bloqueo. Reasignarlo sería otra operación (y otra pregunta:
// qué pasa con las reservas que ese cambio deja tapadas o destapadas).
async function _updateTimeBlock(
  id: string,
  data: Omit<TimeBlockInput, 'professionalId'>,
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
      where: overlappingActiveBookingsWhere(businessId, startDateTime, endDateTime, now, existing.professionalId),
      select: { id: true },
      take: 1,
    })

    if (overlappingBookings.length > 0 && confirmOverlap !== true) {
      const timezone = business.timezone || 'America/Santiago'
      // El bloqueo editado se excluye del "antes": lo que importa es el efecto
      // de su nuevo horario, no el del horario que se está reemplazando.
      const addendum = await serviceFitAddendum({
        businessId,
        timezone,
        proposedBlocks: [{ startDateTime, endDateTime }],
        now,
        professionalId: existing.professionalId,
        excludeBlock: (b) => b.id === id,
      })
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
  /** De quién es el bloqueo recurrente. `null` = del salón. Ver `TimeBlockInput`. */
  professionalId: string | null
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

  const professionalId = await assertOwnerScope(prisma, businessId, data.professionalId)

  // Chequeo ANTES de crear: ocurrencias de la serie propuesta vs reservas
  // activas dentro de la ventana de reserva del negocio. Si hay conflicto y no
  // viene confirmación, NO se crea nada.
  const now = new Date()
  const { occurrences, overlappingDates } = await findSeriesBookingConflicts(
    businessId,
    { id: 'proposed', daysOfWeek: data.daysOfWeek, startTime: data.startTime, endTime: data.endTime, reason: data.reason ?? null, anchorDate: data.anchorDate, until, professionalId },
    timezone,
    now,
    business.bookingWindowDays ?? 90,
  )

  if (overlappingDates.length > 0 && data.confirmed !== true) {
    const addendum = await serviceFitAddendum({ businessId, timezone, proposedBlocks: occurrences, now, professionalId })
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
      professionalId,
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
  const oldUntil = startOfLocalDay(yesterdayStr, timezone)
  const anchorToday = startOfLocalDay(todayStr, timezone)

  // Partir la serie solo cuando conviene conservar el historial (hay pasado Y
  // futuro). Si es solo-futura o ya terminó, editar en el lugar: el split
  // crearía una serie fantasma con anchor>until que no se renderiza (bug real).
  const anchorStr = getLocalDateStr(existing.anchorDate, timezone)
  const untilStr = existing.until ? getLocalDateStr(existing.until, timezone) : null
  const { mode, hasFuture } = planSeriesUpdate(anchorStr, untilStr, todayStr, yesterdayStr)

  // Qué excepciones restablece el horario nuevo. Hacen falta LAS DOS condiciones,
  // porque una excepción vive a caballo de dos fechas (su día original —el
  // RECURRENCE-ID— y el día al que la movieron), y el reset sólo corresponde si
  // las dos caen de hoy en adelante:
  //
  // - `occurrenceDate >= hoy`: el día ORIGINAL tiene que estar en el dominio del
  //   reset. Una excepción cuyo origen quedó en la mitad pasada pertenece a la
  //   serie vieja aunque la hayan movido al futuro: borrarla haría que la serie
  //   vieja REGENERE el bloqueo default en su día original — un bloqueo
  //   apareciendo en el pasado donde no había nada (y el override explícito de
  //   la dueña, que el rescate de #133 sigue mostrando a propósito, se pierde).
  // - `startDateTime >= hoy` (si la movieron): la ocurrencia REAL tampoco puede
  //   haber pasado ya. La movida a ayer ya ocurrió tal como el calendario la
  //   mostró; resetearla "des-ocurre" un bloqueo real — es la tercera capa del
  //   bug de la ocurrencia movida (las otras dos, expandSeries y la query de
  //   getEffectiveBlocks, en #133). La salteada no tiene horario propio
  //   (startDateTime null): su día efectivo es el original, ya cubierto arriba.
  const excepcionesFuturas = {
    seriesId,
    occurrenceDate: { gte: anchorToday },
    OR: [
      { startDateTime: null },
      { startDateTime: { gte: anchorToday } },
    ],
  }

  // Chequeo ANTES de guardar: ocurrencias que TOMARÁN el horario nuevo (de hoy en
  // adelante) vs reservas activas. En split arrancan hoy; in-place solo-futura
  // arrancan en su propio anchor (>= hoy). Sin futuro no hay nada que chequear.
  if (hasFuture) {
    const futureAnchor = mode === 'split' ? anchorToday : existing.anchorDate
    const { occurrences, overlappingDates } = await findSeriesBookingConflicts(
      businessId,
      // La serie propuesta hereda de quién es la que se está editando: editar hora
      // y motivo no cambia el dueño del bloqueo.
      { id: 'proposed', daysOfWeek: existing.daysOfWeek, startTime: changes.startTime, endTime: changes.endTime, reason: changes.reason ?? null, anchorDate: futureAnchor, until: existing.until, professionalId: existing.professionalId },
      timezone,
      now,
      business.bookingWindowDays ?? 90,
    )

    if (overlappingDates.length > 0 && changes.confirmed !== true) {
      // La serie original se excluye del "antes": su horario será reemplazado.
      const addendum = await serviceFitAddendum({
        businessId,
        timezone,
        proposedBlocks: occurrences,
        now,
        professionalId: existing.professionalId,
        excludeBlock: (b) => b.seriesId === seriesId,
      })
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
      prisma.timeBlockException.deleteMany({ where: excepcionesFuturas }),
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
  // edición solo cambia hora/motivo.
  //
  // El reset de las ocurrencias futuras acá es implícito: la nueva serie genera
  // sus días con el horario nuevo, y las excepciones con origen >= hoy quedan
  // colgadas de la vieja, cuyo `until = ayer` las deja fuera de la regla (el
  // rescate de #133 tampoco las materializa: agrega el día original como
  // candidato, pero `esDiaDeLaRegla` lo rechaza contra el until). El deleteMany
  // borra esas filas ya inertes para que ningún cambio futuro del rescate las
  // resucite — mismo criterio que el in-place, a propósito.
  const [, , newSeries] = await prisma.$transaction([
    prisma.timeBlockException.deleteMany({ where: excepcionesFuturas }),
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
        // De quién es el bloqueo también se conserva. HOY es siempre null y esta
        // línea no hace nada — va igual porque es el olvido más caro del track:
        // con `null` significando "cierra para todos", partir el almuerzo
        // recurrente de UNA persona cerraría el local entero, todas las semanas.
        // Es más barato que quede resuelto acá que confiar en que quien escriba el
        // PR B se acuerde de agregarlo a esta copia campo por campo.
        professionalId: existing.professionalId,
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

/** Las series vigentes con el mismo alcance y el mismo porqué que `getTimeBlocks`. */
export async function getTimeBlockSeries(professionalId: string | null = null) {
  const { businessId } = await requireBusiness()
  const owner = await assertOwnerScope(prisma, businessId, professionalId)
  return prisma.timeBlockSeries.findMany({
    where: {
      businessId,
      isActive: true,
      // El alcance va adentro del `AND` y no suelto: esta query ya tiene su propio `OR`
      // —el de `until`— y un segundo `OR` en el mismo nivel lo pisa en silencio, con lo
      // que las series terminadas volverían a aparecer.
      AND: blockScopeCondition(blockScopeFor(owner)),
      OR: [{ until: null }, { until: { gte: new Date() } }],
    },
    include: { professional: { select: { name: true } } },
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
  const series = await assertSeriesOwned(seriesId, businessId)

  // Mismo patrón requiresConfirmation que los bloqueos sueltos: el nuevo rango
  // del día no debe pisar reservas activas sin confirmación explícita.
  const now = new Date()
  const overlappingBookings = await prisma.booking.findMany({
    // La excepción es del día de una serie: hereda de quién es la serie.
    where: overlappingActiveBookingsWhere(businessId, data.startDateTime, data.endDateTime, now, series.professionalId),
    select: { id: true },
    take: 1,
  })

  if (overlappingBookings.length > 0 && data.confirmed !== true) {
    const timezone = business.timezone || 'America/Santiago'
    // La ocurrencia original de ese día se excluye del "antes": será reemplazada.
    const addendum = await serviceFitAddendum({
      businessId,
      timezone,
      proposedBlocks: [{ startDateTime: data.startDateTime, endDateTime: data.endDateTime }],
      now,
      professionalId: series.professionalId,
      excludeBlock: (b) =>
        b.seriesId === seriesId &&
        b.occurrenceDate != null &&
        getLocalDateStr(b.occurrenceDate, timezone) === getLocalDateStr(occurrenceDate, timezone),
    })
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
