import { BT_BALANCE_PREFIX } from '@/lib/bank-transfer/declared'

/** Sub-estado del saldo en /book/confirmation (spec §6). Independiente de
 *  deriveConfirmationState: solo aplica a reservas firmes. */
export function deriveBalanceState(booking: {
  status: string
  remainingBalance: number
  payments: Array<{ status: string; providerPaymentId?: string | null; amount?: number }>
}): { canDeclare: boolean; verifying: boolean; partial: boolean; rejected: boolean; payment: { status: string; amount?: number } | null } {
  const payment = booking.payments.find((p) => p.providerPaymentId?.startsWith(BT_BALANCE_PREFIX)) ?? null
  const isFirm = booking.status === 'confirmed' || booking.status === 'completed'
  if (!isFirm) return { canDeclare: false, verifying: false, partial: false, rejected: false, payment: null }
  const verifying = payment?.status === 'pending'
  const partial = payment?.status === 'approved' && booking.remainingBalance > 0
  return {
    // approved con saldo residual NO reabre el CTA (spec §6 — dead-end de verificación parcial)
    canDeclare: booking.remainingBalance > 0 && !verifying && payment?.status !== 'approved',
    verifying,
    partial,
    rejected: payment?.status === 'rejected',
    payment,
  }
}
