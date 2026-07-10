import { isDeclaredTransferPayment } from '@/lib/bank-transfer/declared'

export type ConfirmationState =
  | 'confirmed'
  | 'verifying'
  | 'verifying_transfer'
  | 'rejected'
  | 'pending'
  | 'expired'
  | 'cancelled'

interface DeriveInput {
  status: string
  payments: { status: string; provider: string; providerPaymentId?: string | null }[]
}

export function deriveConfirmationState(input: DeriveInput): ConfirmationState {
  if (input.status === 'confirmed' || input.status === 'completed') {
    return 'confirmed'
  }
  // Estados terminales primero: una reserva muerta nunca debe mostrar
  // "verificando" por un Payment pendiente huérfano.
  if (input.status === 'expired') return 'expired'
  if (input.status === 'cancelled') return 'cancelled'

  // Transferencia declarada por la clienta (discriminada por bt-declared:).
  if (input.payments.some(isDeclaredTransferPayment)) return 'verifying_transfer'

  const mpPayments = input.payments.filter(p => p.provider === 'mercado_pago')

  if (mpPayments.length === 0) {
    return 'pending'
  }

  const hasApproved = mpPayments.some(p => p.status === 'approved')
  if (hasApproved) {
    return 'confirmed'
  }

  const hasPending = mpPayments.some(
    p => p.status === 'pending' || p.status === 'in_process',
  )
  if (hasPending) {
    return 'verifying'
  }

  const hasFailed = mpPayments.some(
    p => p.status === 'rejected' || p.status === 'cancelled' || p.status === 'failed',
  )
  if (hasFailed) {
    return 'rejected'
  }

  return 'pending'
}
