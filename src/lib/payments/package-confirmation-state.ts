import { isDeclaredPkgTransferPayment, PKG_TRANSFER_PAYMENT_METHOD } from '@/lib/bank-transfer/declared'

/** "La oferta del producto sigue siendo la que la clienta compró": fuente única
 *  de la regla de revive. La usan la confirmation page (mostrar el panel de
 *  retomar, sobre su propio read) y declarePackageTransfer (guard real, sobre un
 *  read fresco pre-tx) — cambiarla acá mantiene UI y server en sincronía. */
export function isPackageOfferUnchanged(
  product: { isActive: boolean; price: number },
  purchase: { pricePaid: number },
): boolean {
  return product.isActive && product.price === purchase.pricePaid
}

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
    input.paymentMethod === PKG_TRANSFER_PAYMENT_METHOD &&
    !input.payments.some(isDeclaredPkgTransferPayment) &&
    !input.payments.some(p => p.provider === 'mercado_pago' && (p.status === 'pending' || p.status === 'in_process'))
  ) {
    return 'awaiting_transfer'
  }
  if (input.payments.some(p => p.status === 'pending' || p.status === 'in_process')) return 'pending'
  if (input.payments.some(p => p.status === 'rejected' || p.status === 'cancelled')) return 'rejected'
  return 'pending'
}
