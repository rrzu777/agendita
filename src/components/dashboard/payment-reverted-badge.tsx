import { Badge } from '@/components/ui/badge'

/** Badge ADICIONAL (no reemplaza el status de la reserva) cuando el pago fue
 *  revertido por chargeback/refund de MP (spec FU-B4b-3 §4). El único writer de
 *  paymentStatus 'refunded' es la rama de reversión del webhook. Null para
 *  cualquier otro paymentStatus. Mismo estilo que el badge "Disputado" de paquetes. */
export function PaymentRevertedBadge({ paymentStatus }: { paymentStatus: string }) {
  if (paymentStatus !== 'refunded') return null
  return <Badge className="bg-red-100 text-red-800">Pago revertido</Badge>
}
