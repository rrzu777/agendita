import { addHours } from 'date-fns'
import { BookingStatus, BookingPaymentStatus } from '@prisma/client'
import { BANK_TRANSFER_METHOD } from '@/lib/bank-transfer/declared'
import { MANUAL_COORDINATION_METHOD } from '@/lib/bookings/hold'

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
 * Estados con un hold con fecha de vencimiento.
 *
 * **No dice si ocupan el cupo**: `pending_confirmation` tiene hold Y ocupa
 * siempre (está también en `OCCUPYING_STATUSES`). Lo que dice es que hay un
 * vencimiento que alguien puede ver morir — lo consume la pantalla de la
 * clienta, que con el hold pasado muestra "Expirada" en vez del estado crudo.
 */
export const STATUSES_WITH_HOLD = [
  BookingStatus.pending_payment,
  BookingStatus.pending_confirmation,
] as const

/**
 * Estados que ocupan el cupo SIEMPRE, sin importar el hold.
 *
 * FUENTE ÚNICA de los dos lugares que deciden si una reserva tapa un slot:
 * `occupiesSlot` (en memoria — la usan `generateSlots` y el chequeo de solape de
 * `findSlotConflict`) y `overlappingActiveBookingsWhere` (un where de Prisma, que
 * no puede llamar a una función). Si agregás un estado, alcanza con tocar acá.
 *
 * `pending_confirmation` entró con la migración `booking_overlap_solicitudes`:
 * desde que el EXCLUDE lo cubre, darlo por libre —con el hold vivo o vencido—
 * ofrecería una hora que el insert rechaza. Lo libera el cron al expirarlo, que
 * es además el único que le avisa por mail a la clienta que nadie le respondió;
 * barrerlo dentro de la transacción de otra reserva, como sí se hace con los
 * holds de pago abandonados, le sacaría la hora en silencio.
 */
export const OCCUPYING_STATUSES = [
  BookingStatus.confirmed,
  BookingStatus.completed,
  BookingStatus.pending_confirmation,
] as const

/**
 * Los cuatro estados que mira el EXCLUDE `Booking_no_overlap`. Es la copia en TS
 * de un WHERE que vive en SQL crudo y que desde acá no se puede importar; el test
 * de integración `booking-overlap-constraint` lee la definición real con
 * `pg_get_constraintdef` y la compara contra esta lista, así que la copia está
 * verificada y no sostenida por memoria.
 */
export const NO_OVERLAP_STATUSES = [
  BookingStatus.pending_payment,
  ...OCCUPYING_STATUSES,
] as const

/** Estados que NO ocupan cupo: la reserva ya no está en pie. Sirve además para no
 *  traer esas filas cuando lo único que se va a hacer con ellas es descartarlas. */
export const RELEASED_STATUSES = [
  BookingStatus.cancelled,
  BookingStatus.no_show,
  BookingStatus.expired,
] as const

/** True si el estado tiene un hold que puede vencer. Ver `STATUSES_WITH_HOLD`. */
export function hasExpirableHold(status: string): boolean {
  return (STATUSES_WITH_HOLD as readonly string[]).includes(status)
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
 * Importa porque el EXCLUDE `Booking_no_overlap` (invisible en
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
 * - **Coordinación manual**: mismo trato que la transferencia y por el mismo
 *   motivo — a esa clienta la pantalla le prometió "el negocio te contacta", y
 *   el único que le avisa que la ventana venció es el cron. Barrerla acá la
 *   deja esperando un contacto que ya no llega, sin mail y sin hora.
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
    b.paymentMethod !== BANK_TRANSFER_METHOD &&
    b.paymentMethod !== MANUAL_COORDINATION_METHOD
  )
}

/** True si esta reserva tapa su horario en el instante `now`. */
export function occupiesSlot(b: SlotOccupancyFields, now: Date): boolean {
  if ((RELEASED_STATUSES as readonly string[]).includes(b.status)) return false
  if ((OCCUPYING_STATUSES as readonly string[]).includes(b.status)) return true
  // El único estado cuyo hold vencido puede liberar el horario. Las solicitudes
  // salieron de acá con `booking_overlap_solicitudes` — el porqué está en
  // `OCCUPYING_STATUSES`.
  if (b.status === BookingStatus.pending_payment) {
    // Sin vencimiento tapa hasta que alguien la resuelva a mano.
    if (!b.holdExpiresAt || b.holdExpiresAt > now) return true
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
 *
 * Como el tope se aplica **al escribir**, la hora de la cita queda persistida
 * adentro del plazo — y por eso **mover la cita obliga a recalcularlo**.
 * `rescheduledHoldPatch` (mutate.ts) vuelve a llamar acá con la cita nueva y el
 * `createdAt` de la reserva: es el único caller que pasa un `now` del PASADO, y
 * justamente por eso reproduce el plazo que se habría guardado si la reserva
 * hubiera nacido con ese horario, en vez de estrenarle una ventana. Si algún día
 * el tope se mueve al leer (como en `holdDeadlinePromise`), ese recálculo sobra.
 */
export function approvalHoldExpiresAt(startDateTime: Date, now = new Date()): Date {
  const window = addHours(now, APPROVAL_WINDOW_HOURS)
  return window < startDateTime ? window : startDateTime
}
