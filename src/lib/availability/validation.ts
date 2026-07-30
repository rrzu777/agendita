import { addMinutes, differenceInMinutes, addDays } from 'date-fns'
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz'
import { getLocalDayOfWeek, getLocalDateStr, startOfLocalDay } from './timezone'
import { LEAD_TIME_MINUTES } from './constants'
import { shrinkBlock } from './shrink-block'
import { expandSeries } from '@/lib/calendar/expand-series'
import { acquireAdvisoryXactLock } from '@/lib/db/advisory-lock'
import { blockScopeFor, normalizeProfessionalId, resolveDayRule } from '@/lib/availability/scope'
import { blockScopeCondition } from '@/lib/availability/effective-blocks'
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

  // Los bloqueos que dejan a esta reserva sin lugar: los del negocio (cierra para
  // todos) más los de la persona a nombre de quien va. Las vacaciones de OTRA
  // persona no tienen nada que ver.
  //
  // Este archivo repite la query de `effective-blocks.ts` en vez de llamarlo
  // porque necesita el `tx` de la transacción; la condición del alcance sí es
  // compartida para que las dos no se desincronicen.
  const scopeCondition = blockScopeCondition(blockScopeFor(professionalId))

  const [oneOffBlocks, blockSeries] = await Promise.all([
    // Query por bordes crudos (superconjunto); la tolerancia se aplica en
    // memoria con shrinkBlock — un bloqueo tolerante puede no bloquear el slot
    // aunque sus bordes crudos lo solapen.
    tx.timeBlock.findMany({
      where: {
        businessId,
        startDateTime: { lt: endDateTime },
        endDateTime: { gt: startDateTime },
        AND: [scopeCondition],
      },
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
        // `AND` y no spread: el `OR` de arriba es de `until` y un segundo `OR` en
        // el mismo nivel lo sobrescribiría sin decir nada.
        AND: [scopeCondition],
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
  const professionalId = normalizeProfessionalId(input.professionalId)
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

  // Una reserva CON persona sólo choca contra las de esa persona y contra las que
  // no tienen ninguna. Una reserva SIN persona no lleva cláusula: choca contra
  // todas, que es lo conservador — son las citas de antes de que hubiera equipo y
  // nunca queremos meterle una encima a alguien.
  const professionalClause =
    professionalId === null
      ? Prisma.empty
      : Prisma.sql`AND ("professionalId" IS NULL OR "professionalId" = ${professionalId})`

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
  if (Array.isArray(overlappingBookings) && overlappingBookings.length > 0) {
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
