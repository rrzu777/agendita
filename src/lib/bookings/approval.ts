import { addHours } from 'date-fns'
import { BookingStatus } from '@prisma/client'

/**
 * Confirmación manual: el negocio acepta o rechaza cada solicitud en vez de que
 * la reserva se confirme sola.
 *
 * **Sólo aplica cuando no hay abono.** Si el servicio pide abono, la reserva ya
 * nace `pending_payment` y el cobro es el filtro: con transferencia bancaria la
 * dueña verifica a mano (puede rechazar), y con Mercado Pago el pago entró. Meter
 * una aprobación DESPUÉS de cobrar obligaría a devolver plata, que es justo lo
 * que el abono existe para evitar. Un negocio que quiere las dos cosas tiene que
 * elegir: o abono, o confirmación manual.
 */

/** Horas que tiene el negocio para responder una solicitud antes de que expire. */
export const APPROVAL_WINDOW_HOURS = 24

/**
 * Estados que ocupan el cupo SÓLO mientras su hold siga vivo. Vencido el hold la
 * agenda se libera aunque el cron todavía no los haya marcado `expired`.
 *
 * FUENTE ÚNICA de los tres lugares que deciden si una reserva tapa un slot:
 * `generateSlots` (en memoria), `overlappingActiveBookingsWhere` (Prisma) y el
 * SQL crudo de `assertNoBookingOverlap`. Ese último **no puede importarla** —
 * parametrizar un `IN` de enums en `$queryRaw` manda los valores como `text` y
 * Postgres rompe con `operator does not exist` — así que repite los literales
 * con un comentario que apunta acá. Si agregás un estado, tocá los cuatro; el
 * test de integración `pending_confirmation ocupa el cupo` es la red.
 */
export const HELD_STATUSES = [
  BookingStatus.pending_payment,
  BookingStatus.pending_confirmation,
] as const

/** Estados que ocupan el cupo siempre, sin importar el hold. */
export const OCCUPYING_STATUSES = [BookingStatus.confirmed, BookingStatus.completed] as const

/** True si el estado sólo ocupa el cupo mientras el hold no venza. */
export function isHeldStatus(status: string): boolean {
  return (HELD_STATUSES as readonly string[]).includes(status)
}

/**
 * Estado inicial de una reserva creada por la clienta.
 *
 * Con abono manda el cobro (`pending_payment`). Sin abono, el flag del negocio
 * decide entre confirmarla sola o dejarla esperando el visto bueno.
 */
export function initialPublicBookingStatus(args: {
  depositRequired: number
  requireBookingApproval: boolean
}): BookingStatus {
  if (args.depositRequired > 0) return BookingStatus.pending_payment
  return args.requireBookingApproval
    ? BookingStatus.pending_confirmation
    : BookingStatus.confirmed
}

/**
 * Vencimiento de una solicitud sin responder.
 *
 * Es el mínimo entre la ventana de respuesta y la hora de la cita: una solicitud
 * para mañana a las 10 no puede seguir "esperando confirmación" a las 11. Se
 * guarda en `holdExpiresAt` (el campo y su índice `[status, holdExpiresAt]` ya
 * existen, y todo lo que lo lee filtra además por status).
 */
export function approvalHoldExpiresAt(startDateTime: Date, now = new Date()): Date {
  const window = addHours(now, APPROVAL_WINDOW_HOURS)
  return window < startDateTime ? window : startDateTime
}
