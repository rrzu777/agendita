import type { BookingStatus } from '@prisma/client'

/** Etiquetas en español de los estados de reserva. Fuente única compartida —
 *  el dashboard todavía tiene copias file-local previas (booking-card,
 *  booking-drawer, calendar-views, bookings/page, customers/[id]) que conviene
 *  migrar acá cuando se toquen. */
export const bookingStatusLabels: Record<BookingStatus, string> = {
  pending_payment: 'Pendiente de pago',
  confirmed: 'Confirmada',
  completed: 'Completada',
  cancelled: 'Cancelada',
  no_show: 'No asistió',
  expired: 'Expirada',
}
