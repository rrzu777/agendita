import { addMinutes, differenceInMinutes, addDays } from 'date-fns'
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz'
import { getLocalDayOfWeek, getLocalDateStr, startOfLocalDay } from './timezone'
import { LEAD_TIME_MINUTES } from './constants'
import { shrinkBlock } from './shrink-block'
import { expandSeries } from '@/lib/calendar/expand-series'
import { acquireAdvisoryXactLock } from '@/lib/db/advisory-lock'
import type { PrismaClient, Prisma } from '@prisma/client'
// UserError: estos mensajes son user-facing y deben sobrevivir al wrapper
// action(); para callers sin wrapper es un Error normal (extends Error).
import { UserError } from '@/lib/actions/result'

export interface AssertSlotInput {
  tx: PrismaClient | Prisma.TransactionClient
  businessId: string
  serviceId: string
  startDateTime: Date
  endDateTime: Date
  timezone: string
  excludeBookingId?: string
  /** Anticipación mínima en minutos; los flujos de la dueña pasan 0 (walk-ins). Default: LEAD_TIME_MINUTES. */
  leadTimeMinutes?: number
}

function logEvent(event: string, meta: Record<string, unknown>) {
  // Log estructurado sin PII; en producción esto podría enviarse a un servicio de logs
  const payload = { timestamp: new Date().toISOString(), event, ...meta }
  console.log(JSON.stringify(payload))
}

export interface AssertConflictInput {
  tx: PrismaClient | Prisma.TransactionClient
  businessId: string
  startDateTime: Date
  endDateTime: Date
  timezone: string
  /** Solo afecta el chequeo de solape de RESERVAS (los TimeBlocks no se eximen). */
  excludeBookingId?: string
}

/**
 * Por qué un slot no está libre. Lo devuelve `findSlotConflict` para los callers
 * que NO pueden lanzar: el webhook de pago necesita asentar la plata que ya entró
 * y decidir qué hacer, no abortar la transacción entera.
 */
export type SlotConflict =
  | { reason: 'end_before_start' }
  | { reason: 'timeblock_overlap' }
  | { reason: 'booking_overlap'; overlappingBookingIds: string[] }

/** Único mensaje de rechazo de horario: la clienta nunca ve el motivo interno. */
const SLOT_UNAVAILABLE_MESSAGE = 'Ese horario ya no está disponible. Por favor selecciona otro.'

async function findTimeBlockConflict(input: AssertConflictInput): Promise<SlotConflict | null> {
  const { tx, businessId, startDateTime, endDateTime, timezone } = input

  const [oneOffBlocks, blockSeries] = await Promise.all([
    // Query por bordes crudos (superconjunto); la tolerancia se aplica en
    // memoria con shrinkBlock — un bloqueo tolerante puede no bloquear el slot
    // aunque sus bordes crudos lo solapen.
    tx.timeBlock.findMany({
      where: { businessId, startDateTime: { lt: endDateTime }, endDateTime: { gt: startDateTime } },
      select: { startDateTime: true, endDateTime: true, overlapToleranceMinutes: true },
    }),
    tx.timeBlockSeries.findMany({
      where: {
        businessId,
        isActive: true,
        anchorDate: { lte: endDateTime },
        // `until` es marcador de día (00:00 local); comparamos contra el piso del
        // día local del slot para no descartar el último día de una serie acotada.
        // Superconjunto seguro: expandSeries filtra el día con precisión.
        OR: [{ until: null }, { until: { gte: startOfLocalDay(getLocalDateStr(startDateTime, timezone), timezone) } }],
      },
      include: { exceptions: true },
    }),
  ])

  const overlapsShrunk = (block: { startDateTime: Date; endDateTime: Date; overlapToleranceMinutes?: number }): boolean => {
    const core = shrinkBlock(block)
    return core !== null && core.start < endDateTime && startDateTime < core.end
  }

  const blockedByOneOff = oneOffBlocks.some(overlapsShrunk)

  // El chequeo de bloqueo corre ANTES del advisory lock; expandir las series en
  // memoria aquí no pierde ninguna garantía de concurrencia (esta protege
  // booking-vs-booking, no bloqueos).
  const blockedBySeries = blockSeries.some((s) =>
    expandSeries(s, s.exceptions, startDateTime, endDateTime, timezone).some(overlapsShrunk),
  )

  if (blockedByOneOff || blockedBySeries) {
    logEvent('slot_validation_rejected', { businessId, reason: 'timeblock_overlap' })
    return { reason: 'timeblock_overlap' }
  }
  return null
}

async function findBookingOverlap(input: AssertConflictInput): Promise<SlotConflict | null> {
  const { tx, businessId, startDateTime, endDateTime, timezone } = input
  const now = new Date()

  // Advisory lock por businessId + día local del negocio.
  // Esto serializa todas las creaciones de reserva para un negocio en un día,
  // evitando doble-booking concurrente incluso entre slots con distinto startDateTime.
  const localStartStr = formatInTimeZone(startDateTime, timezone, 'yyyy-MM-dd')
  await acquireAdvisoryXactLock(tx, `${businessId}:${localStartStr}`)

  // A pending_payment booking only blocks the slot while its hold is still live.
  // Once holdExpiresAt is in the past the slot is free again, even if the cron
  // that flips it to `expired` hasn't run yet — otherwise stale holds freeze
  // slots until the next cron tick. `pending_confirmation` (solicitud esperando
  // el visto bueno del negocio) sigue exactamente la misma regla.
  //
  // Los literales duplican HELD_STATUSES de lib/bookings/approval.ts a propósito:
  // parametrizar un IN de enums en $queryRaw los manda como `text` y Postgres
  // rompe. Si agregás un estado, tocá también ese módulo y sus dos consumidores.
  const overlappingBookings = input.excludeBookingId
    ? await tx.$queryRaw`
      SELECT "id" FROM "Booking"
      WHERE "businessId" = ${businessId}
        AND (
          "status" IN ('confirmed', 'completed')
          OR ("status" IN ('pending_payment', 'pending_confirmation') AND ("holdExpiresAt" IS NULL OR "holdExpiresAt" > ${now}))
        )
        AND "startDateTime" < ${endDateTime}
        AND "endDateTime" > ${startDateTime}
        AND "id" != ${input.excludeBookingId}
      FOR UPDATE
    `
    : await tx.$queryRaw`
      SELECT "id" FROM "Booking"
      WHERE "businessId" = ${businessId}
        AND (
          "status" IN ('confirmed', 'completed')
          OR ("status" IN ('pending_payment', 'pending_confirmation') AND ("holdExpiresAt" IS NULL OR "holdExpiresAt" > ${now}))
        )
        AND "startDateTime" < ${endDateTime}
        AND "endDateTime" > ${startDateTime}
      FOR UPDATE
    `
  if (Array.isArray(overlappingBookings) && overlappingBookings.length > 0) {
    logEvent('slot_validation_rejected', { businessId, reason: 'booking_overlap', overlappingCount: overlappingBookings.length })
    return {
      reason: 'booking_overlap',
      // El cast es el shape del SELECT de arriba: `$queryRaw` devuelve `unknown`
      // y no hay forma de tiparlo desde el template.
      overlappingBookingIds: (overlappingBookings as { id: string }[]).map((b) => b.id),
    }
  }
  return null
}

/**
 * Chequeo de SOLAPE puro que DEVUELVE el conflicto en vez de lanzarlo. Existe
 * para el borde donde ya entró plata: la confirmación de un pago no puede abortar
 * su transacción por un slot ocupado, porque eso desasentaría el cobro que
 * Mercado Pago ya hizo. `assertSlotFreeOfConflicts` es este mismo chequeo con el
 * throw puesto encima, para los callers que sí pueden rechazar.
 *
 * Mismas garantías que antes: el advisory lock por negocio+día y el `FOR UPDATE`
 * viven adentro, así que el resultado sigue siendo válido hasta el fin de la tx.
 */
export async function findSlotConflict(input: AssertConflictInput): Promise<SlotConflict | null> {
  if (input.endDateTime <= input.startDateTime) {
    logEvent('slot_validation_rejected', { businessId: input.businessId, reason: 'end_before_start' })
    return { reason: 'end_before_start' }
  }
  return (await findTimeBlockConflict(input)) ?? (await findBookingOverlap(input))
}

/**
 * Chequeo de SOLAPE puro para revivir reservas: valida solo conflictos contra
 * reservas activas y bloqueos de tiempo (mismo advisory lock que
 * assertSlotIsAvailable). NO exige servicio activo, duración vigente, regla del
 * día ni ventana de reserva — una cita ya pactada no debe caerse porque la
 * dueña cambió el catálogo después (spec §3).
 */
export async function assertSlotFreeOfConflicts(input: AssertConflictInput): Promise<void> {
  if (await findSlotConflict(input)) throw new UserError(SLOT_UNAVAILABLE_MESSAGE)
}

export async function assertSlotIsAvailable(input: AssertSlotInput): Promise<void> {
  const { tx, businessId, serviceId, startDateTime, endDateTime, timezone } = input

  if (endDateTime <= startDateTime) {
    logEvent('slot_validation_rejected', { businessId, reason: 'end_before_start' })
    throw new UserError(SLOT_UNAVAILABLE_MESSAGE)
  }

  const now = new Date()

  // Lead time mínimo (default 2 horas); 0 = permitir desde "ahora" (dueña)
  const leadTimeMinutes = input.leadTimeMinutes ?? LEAD_TIME_MINUTES
  const minStart = addMinutes(now, leadTimeMinutes)
  if (startDateTime < minStart) {
    logEvent('slot_validation_rejected', { businessId, reason: 'lead_time', slotStart: startDateTime.toISOString() })
    throw new UserError(SLOT_UNAVAILABLE_MESSAGE)
  }

  const business = await tx.business.findUnique({
    where: { id: businessId },
    select: { bookingWindowDays: true },
  })

  // Booking window máximo: 90 días por defecto
  const bookingWindowDays = business?.bookingWindowDays ?? 90
  const maxStart = addDays(now, bookingWindowDays)
  if (startDateTime > maxStart) {
    logEvent('slot_validation_rejected', { businessId, reason: 'booking_window', slotStart: startDateTime.toISOString(), maxStart: maxStart.toISOString() })
    throw new UserError(SLOT_UNAVAILABLE_MESSAGE)
  }

  const service = await tx.service.findFirst({
    where: { id: serviceId, businessId, isActive: true },
    select: { durationMinutes: true },
  })
  if (!service) {
    logEvent('slot_validation_rejected', { businessId, reason: 'service_not_found' })
    throw new UserError(SLOT_UNAVAILABLE_MESSAGE)
  }

  const duration = differenceInMinutes(endDateTime, startDateTime)
  if (duration !== service.durationMinutes) {
    logEvent('slot_validation_rejected', { businessId, reason: 'duration_mismatch' })
    throw new UserError(SLOT_UNAVAILABLE_MESSAGE)
  }

  // Usar timezone del negocio para calcular día y rango horario
  const localStartStr = formatInTimeZone(startDateTime, timezone, 'yyyy-MM-dd')
  const localDayOfWeek = getLocalDayOfWeek(startDateTime, timezone)

  const rule = await tx.availabilityRule.findFirst({
    where: { businessId, dayOfWeek: localDayOfWeek, isActive: true },
    select: { startTime: true, endTime: true },
  })
  if (!rule) {
    logEvent('slot_validation_rejected', { businessId, reason: 'no_availability_rule', dayOfWeek: localDayOfWeek })
    throw new UserError(SLOT_UNAVAILABLE_MESSAGE)
  }

  // Construir timestamps UTC reales para inicio y fin de regla
  const ruleStart = fromZonedTime(`${localStartStr} ${rule.startTime}`, timezone)
  const ruleEnd = fromZonedTime(`${localStartStr} ${rule.endTime}`, timezone)

  if (startDateTime < ruleStart || endDateTime > ruleEnd) {
    logEvent('slot_validation_rejected', { businessId, reason: 'outside_rule_hours' })
    throw new UserError(SLOT_UNAVAILABLE_MESSAGE)
  }

  await assertSlotFreeOfConflicts({ tx, businessId, startDateTime, endDateTime, timezone, excludeBookingId: input.excludeBookingId })
}
