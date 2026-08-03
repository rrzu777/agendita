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
 * El status que hay que MOSTRAR, que no siempre es el que la base tiene
 * asentado: con el hold vencido la reserva ya está condenada y sólo falta que
 * el cron —que corre cada hora— lo escriba. Hasta entonces el panel mostraba
 * "Pendiente de pago" en naranja sobre algo que nadie va a pagar, y al lado
 * ofrecía "Cobrar" (ver `isManualPaymentAllowed`, que ahora mira lo mismo).
 *
 * Devuelve un status y no una etiqueta a propósito: el badge deriva de la clave
 * el TEXTO y el COLOR, así que topar acá arregla los dos de una vez, en las
 * tres superficies del panel (tabla, card móvil, drawer del calendario).
 *
 * `isDoomedHold` espeja las condiciones de los sweeps del cron — o sea, esto
 * adelanta exactamente lo que el sistema va a hacer, no una opinión. Es el
 * mismo criterio con el que /mi le habla a la clienta (ver su `statusLabel`),
 * con UNA divergencia deliberada: /mi también deja ganar a un pago de Mercado
 * Pago en vuelo, porque a ella se le está pidiendo que pague. El panel no
 * consulta esos pagos y no debería: el cron tampoco los mira antes de expirar.
 */
export function effectiveBookingStatus(
  // `string` además de `Date` por el payload serializado del calendario, mismo
  // criterio que `getReviveReopenState`.
  booking: { status: string; paymentStatus: string; holdExpiresAt: Date | string | null },
  now: Date = new Date(),
): string {
  const holdExpiresAt = booking.holdExpiresAt == null ? null : new Date(booking.holdExpiresAt)
  return isDoomedHold({ ...booking, holdExpiresAt }, now) ? 'expired' : booking.status
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