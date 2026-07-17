import { isDeclaredPkgTransferPayment } from '@/lib/bank-transfer/declared'

export type PackageConfirmationState =
  | 'active'
  | 'pending'
  | 'awaiting_transfer'
  | 'rejected'
  | 'expired'
  | 'refunded'
  | 'disputed'

interface DeriveInput {
  status: string
  /** PackagePurchase.paymentMethod: 'Transferencia' cuando la clienta eligió transferir. */
  paymentMethod?: string | null
  /** Set sólo en un chargeback (distingue disputed de un refund voluntario). */
  chargebackAt?: Date | null
  payments: { status: string; provider: string; providerPaymentId?: string | null }[]
}

/** Mirror liviano de deriveConfirmationState para compras de paquete. El status
 *  de la compra manda (terminal); si sigue pending, se deriva del método + pagos.
 *  `awaiting_transfer` = eligió transferencia y todavía no declaró NI hay un pago
 *  MP en vuelo (espejo del where del recordatorio de reservas: un MP iniciado en
 *  otra pestaña no debe mostrar "te falta transferir"). */
export function derivePackageConfirmationState(input: DeriveInput): PackageConfirmationState {
  if (input.status === 'active') return 'active'
  if (input.status === 'expired') return 'expired'
  if (input.status === 'refunded') return input.chargebackAt ? 'disputed' : 'refunded'
  if (input.status === 'rejected') return 'rejected'
  if (input.payments.some(p => p.status === 'approved')) return 'active'
  if (
    input.paymentMethod === 'Transferencia' &&
    !input.payments.some(isDeclaredPkgTransferPayment) &&
    !input.payments.some(p => p.provider === 'mercado_pago' && (p.status === 'pending' || p.status === 'in_process'))
  ) {
    return 'awaiting_transfer'
  }
  if (input.payments.some(p => p.status === 'pending' || p.status === 'in_process')) return 'pending'
  if (input.payments.some(p => p.status === 'rejected' || p.status === 'cancelled')) return 'rejected'
  return 'pending'
}
