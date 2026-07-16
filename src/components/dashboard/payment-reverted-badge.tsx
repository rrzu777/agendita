import { PAYMENT_REVERTED_LABEL, PAYMENT_REVERTED_BADGE_CLASS } from '@/lib/bookings/status-labels'

/** Badge ADICIONAL (no reemplaza el status de la reserva) cuando el pago fue
 *  revertido por chargeback/refund de MP. Null para cualquier otro paymentStatus. */
export function PaymentRevertedBadge({ paymentStatus }: { paymentStatus: string }) {
  if (paymentStatus !== 'refunded') return null
  return <span className={PAYMENT_REVERTED_BADGE_CLASS}>{PAYMENT_REVERTED_LABEL}</span>
}
