import { BookingStatus, BookingPaymentStatus } from '@prisma/client'
import type { Prisma } from '@prisma/client'

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

/**
 * Actualiza el estado de una reserva y crea un asiento contable (ledger)
 * como resultado de un pago aprobado. NO crea el registro Payment;
 * es responsabilidad del llamador crear/actualizar Payment antes de
 * invocar esta función.
 *
 * Usada por:
 * - verifyAndConfirmPayment (flujo público de pago online)
 * - confirmPayment (flujo privado de confirmación manual/dashboard)
 * - webhook Mercado Pago (flujo sin sesión)
 */
export async function applyPaymentToBooking(
  tx: Prisma.TransactionClient,
  bookingId: string,
  amount: number,
  paymentId: string
) {
  const booking = await tx.booking.findUnique({ where: { id: bookingId } })
  if (!booking) throw new Error('Reserva no encontrada')
  assertBookingPayable(booking)
  if (amount <= 0) throw new Error('El monto debe ser positivo')
  if (amount > booking.remainingBalance) throw new Error('El monto excede el saldo pendiente')

  const newPaid = booking.depositPaid + amount
  const isFullPayment = newPaid >= booking.finalAmount

  const updatedBooking = await tx.booking.update({
    where: { id: bookingId },
    data: {
      depositPaid: newPaid,
      remainingBalance: Math.max(0, booking.finalAmount - newPaid),
      paymentStatus: isFullPayment ? BookingPaymentStatus.fully_paid : BookingPaymentStatus.deposit_paid,
      status: BookingStatus.confirmed,
    },
  })

  await tx.ledgerEntry.create({
    data: {
      businessId: booking.businessId,
      bookingId,
      paymentId,
      customerId: booking.customerId,
      type: isFullPayment ? 'full_payment_paid' : 'deposit_paid',
      direction: 'income',
      amount,
      currency: 'CLP',
      description: `${isFullPayment ? 'Pago total' : 'Abono'} para reserva ${booking.id.slice(-4)}`,
      occurredAt: new Date(),
    },
  })

  return updatedBooking
}
