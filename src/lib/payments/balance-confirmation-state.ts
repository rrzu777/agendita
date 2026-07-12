import { BT_BALANCE_PREFIX, isFirmBooking } from '@/lib/bank-transfer/declared'

/** Sub-estado del saldo en /book/confirmation (spec §6). Independiente de
 *  deriveConfirmationState: solo aplica a reservas firmes. */
export function deriveBalanceState(booking: {
  status: string
  remainingBalance: number
  payments: Array<{ status: string; providerPaymentId?: string | null; amount: number; proofKey?: string | null }>
}): { canDeclare: boolean; verifying: boolean; partial: boolean; rejected: boolean; payment: { status: string; amount: number; hasProof: boolean } | null } {
  const raw = booking.payments.find((p) => p.providerPaymentId?.startsWith(BT_BALANCE_PREFIX)) ?? null
  const isFirm = isFirmBooking(booking.status)
  if (!isFirm) return { canDeclare: false, verifying: false, partial: false, rejected: false, payment: null }
  const verifying = raw?.status === 'pending'
  const partial = raw?.status === 'approved' && booking.remainingBalance > 0
  // hasProof: la clienta ya adjuntó el comprobante (proofKey en R2) — cierra el loop
  // en /book/confirmation para que no vuelva a subirlo.
  const payment = raw ? { status: raw.status, amount: raw.amount, hasProof: raw.proofKey != null } : null
  return {
    // approved con saldo residual NO reabre el CTA (spec §6 — dead-end de verificación parcial)
    canDeclare: booking.remainingBalance > 0 && !verifying && raw?.status !== 'approved',
    verifying,
    partial,
    rejected: raw?.status === 'rejected',
    payment,
  }
}
