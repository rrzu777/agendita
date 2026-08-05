import type { Prisma } from '@prisma/client'
import {
  anyDeclaredTransferWhere,
  hasPendingDeclaredTransfer,
} from '@/lib/bank-transfer/declared'

type HoldPrecedencePayment = {
  provider: string
  status: string
  providerPaymentId?: string | null
}

type BookingWithHoldPrecedencePayments = {
  status: string
  payments: HoldPrecedencePayment[]
}

/**
 * Pagos que cambian cómo se muestra una reserva mientras el cron todavía no
 * asentó el vencimiento: una transferencia declarada o un pago de Mercado Pago
 * en vuelo. Las consultas del panel y de /mi comparten este fragmento para no
 * tomar decisiones distintas sobre la misma reserva.
 */
export const holdPrecedencePaymentWhere = {
  OR: [
    anyDeclaredTransferWhere,
    { provider: 'mercado_pago', status: 'pending' },
  ],
} satisfies Prisma.PaymentWhereInput

export function hasPendingMercadoPagoPayment(
  booking: Pick<BookingWithHoldPrecedencePayments, 'payments'>,
): boolean {
  return booking.payments.some(
    (payment) =>
      payment.provider === 'mercado_pago' && payment.status === 'pending',
  )
}

/** La precedencia en memoria, espejo del `where` anterior para reservas. */
export function hasPaymentThatOverridesExpiredHold(
  booking: BookingWithHoldPrecedencePayments,
): boolean {
  return (
    hasPendingDeclaredTransfer(booking) ||
    hasPendingMercadoPagoPayment(booking)
  )
}
