import type { BookingStatus } from '@prisma/client'
import { isDoomedHold } from '@/lib/payments/confirmation-state'

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

/** Lookup tolerante para payloads donde `status` viene tipado como string
 *  (p. ej. CalendarBooking). Cae al status crudo si no hay etiqueta. */
export function bookingStatusLabel(status: string): string {
  return (bookingStatusLabels as Partial<Record<string, string>>)[status] ?? status
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

/**
 * El status que hay que MOSTRAR, que no siempre es el que la base tiene
 * asentado. Devuelve un status y no una etiqueta a propósito: el badge deriva
 * de la clave el TEXTO y el COLOR, así que se arreglan los dos de una vez.
 *
 * SÓLO deriva `pending_payment`. `isDoomedHold` también da por muerta a la
 * solicitud sin responder, y para la CLIENTA está bien (ver el `statusLabel` de
 * /mi) — pero acá la que mira es la dueña, y ella todavía puede aceptarla:
 * `VALID_STATUS_TRANSITIONS` permite `pending_confirmation → confirmed` sin
 * mirar el hold, y `_updateBookingStatus` hasta limpia el plazo al aprobar.
 * Rotularla "Expirada" al lado de un botón "Aceptar" que funciona la haría
 * abandonar una reserva que estaba a un clic de salvarse.
 *
 * OJO — el llamador tiene que respetar la precedencia que documenta
 * `isDoomedHold`: una transferencia declarada o un pago en vuelo GANAN sobre el
 * plazo vencido. La tabla y la card cortan antes con `hasPendingDeclaredTransfer`;
 * una superficie que no pueda evaluar esa precedencia (porque su consulta no
 * trae `payments`) NO debe llamar a esta función, o le va a decir "vencido" a
 * quien pagó en fecha.
 */
export function effectiveBookingStatus(
  booking: { status: string; paymentStatus: string; holdExpiresAt: Date | null },
  now: Date = new Date(),
): string {
  if (booking.status !== 'pending_payment') return booking.status
  return isDoomedHold(booking, now) ? HOLD_EXPIRED_STATUS : booking.status
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