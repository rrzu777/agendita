export type PackageConfirmationState =
  | 'active'
  | 'pending'
  | 'rejected'
  | 'expired'
  | 'refunded'
  | 'disputed'

interface DeriveInput {
  status: string
  /** Set sólo en un chargeback (distingue disputed de un refund voluntario). */
  chargebackAt?: Date | null
  payments: { status: string }[]
}

/** Mirror liviano de deriveConfirmationState para compras de paquete. El status
 *  de la compra manda (terminal); si sigue pending, se deriva del pago. */
export function derivePackageConfirmationState(input: DeriveInput): PackageConfirmationState {
  if (input.status === 'active') return 'active'
  if (input.status === 'expired') return 'expired'
  if (input.status === 'refunded') return input.chargebackAt ? 'disputed' : 'refunded'
  if (input.status === 'rejected') return 'rejected'
  if (input.payments.some(p => p.status === 'approved')) return 'active'
  if (input.payments.some(p => p.status === 'pending' || p.status === 'in_process')) return 'pending'
  if (input.payments.some(p => p.status === 'rejected' || p.status === 'cancelled')) return 'rejected'
  return 'pending'
}
