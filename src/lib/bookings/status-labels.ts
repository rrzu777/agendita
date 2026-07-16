import type { BookingStatus } from '@prisma/client'

/** Etiquetas en español de los estados de reserva. Fuente única compartida
 *  para /mi y el dashboard (status-badge, booking-drawer, calendar-views,
 *  new-booking-form). Sin imports server-only: la consumen componentes. */
export const bookingStatusLabels: Record<BookingStatus, string> = {
  pending_payment: 'Pendiente de pago',
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

// Marcador de pago revertido (chargeback o refund vía panel MP — spec FU-B4b-3 §4).
// El único writer de paymentStatus 'refunded' es la rama de reversión del webhook.
export const PAYMENT_REVERTED_LABEL = 'Pago revertido'
export const PAYMENT_REVERTED_BADGE_CLASS =
  'inline-flex w-fit items-center rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800'
