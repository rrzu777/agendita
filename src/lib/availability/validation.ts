import { addMinutes, differenceInMinutes, addDays } from 'date-fns'
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz'
import { getLocalDayOfWeek, getLocalDateStr, startOfLocalDay } from './timezone'
import { LEAD_TIME_MINUTES } from './constants'
import { shrinkBlock } from './shrink-block'
import { expandSeries } from '@/lib/calendar/expand-series'
import { acquireAdvisoryXactLock } from '@/lib/db/advisory-lock'
import { blockScopeFor, bookingScopeSql, resolveDayRule } from '@/lib/availability/scope'
import { getEffectiveBlocks } from '@/lib/availability/effective-blocks'
// `Prisma` entra como VALOR y no sólo como tipo: el SQL crudo del solape compone
// fragmentos con `Prisma.sql` / `Prisma.empty` en vez de repetir la consulta entera
// por cada combinación de cláusulas opcionales.
import { Prisma } from '@prisma/client'
import type { PrismaClient } from '@prisma/client'
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
  /**
   * A nombre de quién es la reserva. `null` = sin persona: se valida contra el
   * horario del negocio y choca contra TODAS las reservas.
   *
   * Obligatorio y no opcional a propósito. Un `undefined` que llegue a un `where`
   * de Prisma no significa "sin persona": Prisma borra la clave y el filtro pasa a
   * matchear todo, o sea "traeme la regla de cualquiera". Sería el mismo bug que
   * ya mordió una vez, pero en el camino crítico de reservar.
   */
  professionalId: string | null
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
  /** A nombre de quién. Ver `AssertSlotInput.professionalId`. */
  professionalId: string | null
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
  const { tx, businessId, startDateTime, endDateTime, timezone, professionalId } = input

  // La MISMA función que usa el funnel para ofrecer horas, con el `tx` de esta
  // transacción. Antes este archivo repetía las dos queries, el truco del
  // superconjunto de `until` y el fan-out de series por su cuenta: eran las dos
  // puntas del mismo contrato, y si se separaban se ofrecía una hora que después se
  // rechazaba (o se escribía una reserva encima de un bloqueo).
  //
  // El alcance sale de la persona a nombre de quien va la reserva: los bloqueos del
  // negocio la dejan sin lugar, los de OTRA persona no tienen nada que ver.
  //
  // Corre ANTES del advisory lock, y está bien: el lock protege reserva-vs-reserva,
  // no bloqueos.
  const blocks = await getEffectiveBlocks({
    businessId,
    rangeStart: startDateTime,
    rangeEnd: endDateTime,
    timezone,
    scope: blockScopeFor(professionalId),
    client: tx,
  })

  // La query trae un superconjunto por bordes crudos; la tolerancia se aplica acá con
  // shrinkBlock — un bloqueo tolerante puede no bloquear el slot aunque sus bordes
  // crudos lo solapen, y uno que apenas se toca en el borde tampoco (`<` estricto).
  const blocked = blocks.some((block) => {
    const core = shrinkBlock(block)
    return core !== null && core.start < endDateTime && startDateTime < core.end
  })

  if (blocked) {
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
  //
  // La persona NO entra en la llave, aunque el plan original lo pedía: una reserva
  // vieja con `professionalId = null` tomaría otro lock, no se serializaría contra
  // las que sí tienen persona, y entrarían las dos pisándose. El costo de dejarlo
  // grueso son milisegundos de espera entre dos clientas del mismo día.
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
  // Las cláusulas opcionales se componen como fragmentos en vez de repetir la
  // consulta entera por combinación: con dos opcionales serían CUATRO copias del
  // mismo SELECT, y la que se olvide de actualizar es la que se lleva el bug.
  const excludeClause = input.excludeBookingId
    ? Prisma.sql`AND "id" != ${input.excludeBookingId}`
    : Prisma.empty

  // El filtro de persona sale de `scope.ts`, pegado a la versión Prisma que usan los
  // lectores: son la lectura y la escritura del mismo contrato, y separarlas es cómo
  // se llega a que el funnel ofrezca una hora que la escritura rechaza.
  const professionalClause = bookingScopeSql(input.professionalId)

  const overlappingBookings = await tx.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "Booking"
    WHERE "businessId" = ${businessId}
      AND (
        "status" IN ('confirmed', 'completed')
        OR ("status" IN ('pending_payment', 'pending_confirmation') AND ("holdExpiresAt" IS NULL OR "holdExpiresAt" > ${now}))
      )
      AND "startDateTime" < ${endDateTime}
      AND "endDateTime" > ${startDateTime}
      ${excludeClause}
      ${professionalClause}
    FOR UPDATE
  `
  if (overlappingBookings.length > 0) {
    logEvent('slot_validation_rejected', { businessId, reason: 'booking_overlap', overlappingCount: overlappingBookings.length })
    return {
      reason: 'booking_overlap',
      overlappingBookingIds: overlappingBookings.map((b) => b.id),
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

  // `resolveDayRule` y no un `findFirst` a mano: la herencia del horario (sin
  // filas propias, rige el del negocio) tiene que ser la misma que ve el funnel al
  // ofrecer los slots, o se puede ofrecer una hora que después se rechaza.
  const rule = await resolveDayRule(tx, businessId, input.professionalId, localDayOfWeek)
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

  await assertSlotFreeOfConflicts({ tx, businessId, startDateTime, endDateTime, timezone, professionalId: input.professionalId, excludeBookingId: input.excludeBookingId })
}
