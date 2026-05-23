export type ConfirmationState = 'confirmed' | 'verifying' | 'rejected' | 'pending'

interface DeriveInput {
  status: string
  payments: { status: string; provider: string }[]
}

export function deriveConfirmationState(input: DeriveInput): ConfirmationState {
  if (input.status === 'confirmed' || input.status === 'completed') {
    return 'confirmed'
  }

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
