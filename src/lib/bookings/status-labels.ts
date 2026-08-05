import type { BookingStatus } from '@prisma/client'
import { isExpiredPaymentHold } from '@/lib/payments/confirmation-state'
import { hasPaymentThatOverridesExpiredHold } from '@/lib/payments/hold-precedence'

/** Etiquetas en español de los estados de reserva. Fuente única compartida
 *  para /mi y el dashboard (status-badge, booking-drawer, calendar-views,
 *  new-booking-form). Sin imports server-only: la consumen componentes. */
export const bookingStatusLabels: Record<BookingStatus, string> = {
  pending_payment: 'Pendiente de pago',
  pending_confirmation: 'Por confirmar',
  confirmed: 'Confirmada',
  completed: 'Completada',
  cancelled: 'Cancelada',
  no_show: 'No asistió',
  expired: 'Expirada',
}

/**
 * Estado DERIVADO, no asentado: el plazo para pagar venció y la reserva sigue
 * en `pending_payment` porque el cron todavía no pasó (corre cada hora, y
 * GitHub puede atrasarlo ~15 min más). Hasta entonces el panel mostraba
 * "Pendiente de pago" en naranja sobre algo que el server ya no deja cobrar.
 *
 * NO reusa la clave `expired`, y eso importa: en este panel `expired` es un
 * estado asentado y ACCIONABLE — tiene "Revivir" al lado, que exige
 * `status: 'expired'` en la base. Pintar de "Expirada" algo que todavía no lo
 * está prometía una acción que no aparece.
 */
export const HOLD_EXPIRED_STATUS = 'hold_expired'

/** La palabra. Afuera del mapa del badge porque las dos superficies que la
 *  dicen (la tabla y el chip) tienen mapas de color distintos. */
export const HOLD_EXPIRED_LABEL = 'Plazo vencido'

/** Las etiquetas de los estados ASENTADOS más las de los derivados. Es lo que
 *  tiene que mirar cualquier lookup por string: `bookingStatusLabel` cae al
 *  status crudo cuando no lo encuentra, así que una clave que falte acá no
 *  rompe nada — imprime `hold_expired` en la pantalla. */
const displayableStatusLabels: Record<string, string> = {
  ...bookingStatusLabels,
  [HOLD_EXPIRED_STATUS]: HOLD_EXPIRED_LABEL,
}

/** Lookup tolerante para payloads donde `status` viene tipado como string
 *  (p. ej. CalendarBooking). Cae al status crudo si no hay etiqueta. */
export function bookingStatusLabel(status: string): string {
  return displayableStatusLabels[status] ?? status
}

/**
 * El status que hay que MOSTRAR, que no siempre es el que la base tiene
 * asentado. Devuelve un status y no una etiqueta a propósito: el badge deriva
 * de la clave el TEXTO y el COLOR, así que se arreglan los dos de una vez.
 *
 * SÓLO deriva `pending_payment`. `isDoomedBooking` también da por muerta a la
 * solicitud sin responder, y para la CLIENTA está bien (ver el `statusLabel` de
 * /mi) — pero acá la que mira es la dueña, y ella todavía puede aceptarla:
 * `VALID_STATUS_TRANSITIONS` permite `pending_confirmation → confirmed` sin
 * mirar el hold, y `_updateBookingStatus` hasta limpia el plazo al aprobar.
 * Rotularla "Expirada" al lado de un botón "Aceptar" que funciona la haría
 * abandonar una reserva que estaba a un clic de salvarse.
 *
 * Sin la precedencia de pagos: casi siempre querés `displayedBookingStatus`.
 * Directo sólo si cortás vos antes, como la tabla de Reservas, que pinta su
 * badge propio de "Transferencia por verificar".
 *
 * `now` es OBLIGATORIO, igual que en `isExpiredPaymentHold`, el que decide abajo. El
 * default `new Date()` que tenía era una trampa: adentro de un componente
 * cliente el servidor lo evaluaba en un instante y el navegador en otro al
 * hidratar, y una reserva cuyo plazo vencía en ese hueco salía con un estado
 * distinto de cada lado — hydration mismatch (React #418), que tumba la página
 * entera, no ese badge. Pedirlo obliga a que cada pantalla diga de qué reloj
 * sale; las que renderiza el server pasan el suyo y lo bajan como prop.
 */
export function effectiveBookingStatus(
  booking: { status: string; paymentStatus: string; holdExpiresAt: Date | null },
  now: Date,
): string {
  if (booking.status !== 'pending_payment') return booking.status
  return isExpiredPaymentHold(booking, now) ? HOLD_EXPIRED_STATUS : booking.status
}

/**
 * El status a MOSTRAR, con la precedencia de pagos ya aplicada: la versión que
 * se puede llamar sin acordarse de la regla.
 *
 * Pide `payments` con provider/status en el tipo A PROPÓSITO: la precedencia
 * vivía en prosa, así que una superficie cuya consulta sólo traía
 * transferencias podía derivar igual y decirle "Plazo vencido" a quien tenía
 * un pago de Mercado Pago en vuelo. Ahora no compila si olvida esos campos.
 * El `where` compartido que alimenta este contrato es
 * `holdPrecedencePaymentWhere`.
 */
export function displayedBookingStatus(
  booking: {
    status: string
    paymentStatus: string
    holdExpiresAt: Date | null
    payments: Array<{
      provider: string
      status: string
      providerPaymentId?: string | null
    }>
  },
  now: Date,
): string {
  // La transferencia declarada y el pago MP en vuelo ganan: ambos todavía
  // pueden confirmar la reserva. El cron puede barrerla entretanto, pero
  // mostrarla vencida haría que la dueña abandone un pago que sigue resolviendo.
  if (hasPaymentThatOverridesExpiredHold(booking)) return booking.status
  return effectiveBookingStatus(booking, now)
}

/**
 * Los estados de los que una reserva ya no sale: no se reprograma, no se
 * reasigna, no se cancela "de nuevo". FUENTE ÚNICA compartida UI ↔ server —
 * este literal estaba copiado en siete lugares y una copia del lado del
 * navegador que quede más permisiva que el server no falla: deja un botón que
 * ofrece lo que el server va a rechazar.
 *
 * `expired` es terminal PARA ESTOS caminos; su única salida es reviveBooking,
 * que re-valida cupo aparte.
 */
export const TERMINAL_BOOKING_STATUSES = ['completed', 'cancelled', 'no_show', 'expired'] as const satisfies readonly BookingStatus[]

/** El chequeo en versión string, para payloads del navegador (CalendarBooking). */
export function isTerminalBookingStatus(status: string): boolean {
  return (TERMINAL_BOOKING_STATUSES as readonly string[]).includes(status)
}
