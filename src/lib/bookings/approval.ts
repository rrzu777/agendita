import { addHours } from 'date-fns'
import { BookingStatus, BookingPaymentStatus } from '@prisma/client'
import { BANK_TRANSFER_METHOD } from '@/lib/bank-transfer/declared'

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
 * agenda se libera aunque el cron todavía no los haya marcado `expired` — con
 * las excepciones que documenta `occupiesSlot`.
 *
 * FUENTE ÚNICA de los dos lugares que deciden si una reserva tapa un slot:
 * `occupiesSlot` (en memoria — la usan `generateSlots` y el chequeo de solape de
 * `findSlotConflict`) y `overlappingActiveBookingsWhere` (un where de Prisma, que
 * no puede llamar a una función). Si agregás un estado, tocá los dos; el test de
 * integración `pending_confirmation ocupa el cupo` es la red.
 */
export const HELD_STATUSES = [
  BookingStatus.pending_payment,
  BookingStatus.pending_confirmation,
] as const

/** Estados que ocupan el cupo siempre, sin importar el hold. */
export const OCCUPYING_STATUSES = [BookingStatus.confirmed, BookingStatus.completed] as const

/** Estados que NO ocupan cupo: la reserva ya no está en pie. */
const RELEASED_STATUSES = [
  BookingStatus.cancelled,
  BookingStatus.no_show,
  BookingStatus.expired,
] as const

/** True si el estado sólo ocupa el cupo mientras el hold no venza. */
export function isHeldStatus(status: string): boolean {
  return (HELD_STATUSES as readonly string[]).includes(status)
}

/** Lo mínimo de una reserva para decidir si tapa su horario. */
export interface SlotOccupancyFields {
  status: string
  holdExpiresAt?: Date | null
  /** Ausente cuenta como "no sé, entonces tapa": ver `isSweepableExpiredHold`. */
  paymentStatus?: string | null
  paymentMethod?: string | null
}

/**
 * ¿Este hold vencido lo puede marcar `expired` un sweep, acá y ahora, sin
 * avisarle a nadie?
 *
 * Importa porque el EXCLUDE `Booking_no_overlap` (migración `init`, invisible en
 * schema.prisma) mira el status y NADA MÁS: mientras la fila siga en
 * `pending_payment`, Postgres rechaza toda reserva que la solape, hold vencido o
 * no. Tratar el horario como libre sólo es honesto si en la misma transacción lo
 * podemos liberar de verdad. Dos familias quedan afuera:
 *
 * - **Con plata encima** (`paymentStatus != 'unpaid'`): el cron tampoco las barre
 *   (filtra por `paymentStatus: 'unpaid'`). El caso real es la reserva que pagó
 *   pero no confirmó porque el horario ya estaba tomado: esa plata y esa hora las
 *   decide una persona, no un sweep.
 * - **Transferencia bancaria**: si la clienta declaró "ya transferí", barrerla en
 *   silencio le saca la hora sin decirle nada. El cron la expira igual, pero
 *   mandando el mail de transferencia vencida (`lib/cron/expire-holds.ts`).
 *   Discriminamos por `paymentMethod` en vez de "¿tiene un Payment declarado?"
 *   para no cargar los pagos en la generación de slots: es más grueso pero del
 *   lado seguro ({declaradas} ⊆ {transferencia}), y lo único que cuesta es que un
 *   checkout de transferencia abandonado retenga el cupo hasta el próximo cron.
 *
 * `paymentStatus` ausente devuelve false a propósito: un caller que no trajo el
 * campo prefiere ofrecer un slot de menos antes que uno que la BD va a rechazar.
 */
export function isSweepableExpiredHold(b: SlotOccupancyFields, now: Date): boolean {
  return (
    b.status === BookingStatus.pending_payment &&
    !!b.holdExpiresAt &&
    b.holdExpiresAt <= now &&
    b.paymentStatus === BookingPaymentStatus.unpaid &&
    b.paymentMethod !== BANK_TRANSFER_METHOD
  )
}

/** True si esta reserva tapa su horario en el instante `now`. */
export function occupiesSlot(b: SlotOccupancyFields, now: Date): boolean {
  if ((RELEASED_STATUSES as readonly string[]).includes(b.status)) return false
  if ((OCCUPYING_STATUSES as readonly string[]).includes(b.status)) return true
  if (isHeldStatus(b.status)) {
    // Sin vencimiento tapa hasta que alguien la resuelva a mano.
    if (!b.holdExpiresAt || b.holdExpiresAt > now) return true
    // Una solicitud vencida siempre libera: no está en la lista de estados del
    // EXCLUDE, así que tratarla como libre no puede hacer fallar un insert, y el
    // sweep de solicitudes del cron la barre sin condiciones de pago.
    if (b.status === BookingStatus.pending_confirmation) return false
    return !isSweepableExpiredHold(b, now)
  }
  // Estado nuevo del enum que nadie clasificó: tapar es el error reversible.
  return true
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
