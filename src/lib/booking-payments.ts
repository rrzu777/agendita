import { BookingStatus } from '@prisma/client'

export class BookingNotPayableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BookingNotPayableError'
  }
}

/**
 * Verifica que una reserva esté en estado pagable y que su hold no haya expirado.
 * Lanza BookingNotPayableError si no es pagable.
 */
export function assertBookingPayable(booking: {
  status: BookingStatus
  holdExpiresAt: Date | null
}): void {
  const terminalStatuses: BookingStatus[] = [
    BookingStatus.cancelled,
    BookingStatus.expired,
    BookingStatus.no_show,
    BookingStatus.completed,
  ]
  if (terminalStatuses.includes(booking.status)) {
    throw new BookingNotPayableError('No se puede procesar pago para esta reserva')
  }

  if (
    booking.status === BookingStatus.pending_payment &&
    booking.holdExpiresAt &&
    booking.holdExpiresAt < new Date()
  ) {
    throw new BookingNotPayableError('El tiempo para pagar esta reserva ha expirado')
  }
}
