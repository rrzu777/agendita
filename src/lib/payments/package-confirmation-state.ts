export type PackageConfirmationState = 'active' | 'pending' | 'rejected'

interface DeriveInput {
  status: string
  payments: { status: string }[]
}

/** Mirror liviano de deriveConfirmationState para compras de paquete. */
export function derivePackageConfirmationState(input: DeriveInput): PackageConfirmationState {
  if (input.status === 'active') return 'active'
  if (input.payments.some(p => p.status === 'approved')) return 'active'
  if (input.payments.some(p => p.status === 'pending' || p.status === 'in_process')) return 'pending'
  if (input.payments.some(p => p.status === 'rejected' || p.status === 'cancelled' || p.status === 'refunded')) return 'rejected'
  return 'pending'
}
