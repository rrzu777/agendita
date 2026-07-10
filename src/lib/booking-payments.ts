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
 *
 * `allowExpiredHold`: salta SOLO el chequeo de hold vencido (no revive estados
 * terminales). Lo usa el verificador de transferencia, que ya re-validó el cupo
 * dentro de su propia tx y no debería tener que escribir un holdExpiresAt falso
 * solo para pasar por acá.
 */
export function assertBookingPayable(
  booking: {
    status: BookingStatus
    holdExpiresAt: Date | null
  },
  opts?: { allowExpiredHold?: boolean },
): void {
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
    !opts?.allowExpiredHold &&
    booking.status === BookingStatus.pending_payment &&
    booking.holdExpiresAt &&
    booking.holdExpiresAt < new Date()
  ) {
    throw new BookingNotPayableError('El tiempo para pagar esta reserva ha expirado')
  }
}
