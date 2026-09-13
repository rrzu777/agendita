import type { PromoCore } from './evaluate'

/** One free-service reward covers the first eligible selected line; percentage
 * and fixed rewards share an eligible subtotal. Never discount unrelated lines. */
export function promotionLineScope(
  promo: Pick<PromoCore, 'appliesToAll' | 'serviceIds' | 'rewardType'>,
  lines: { serviceId: string; price: number }[],
) {
  const covered = lines.filter(line => promo.appliesToAll || promo.serviceIds.includes(line.serviceId))
  const eligible = promo.rewardType === 'free_service' ? covered.filter(line => line.price > 0).slice(0, 1) : covered
  return { serviceIds: eligible.map(l => l.serviceId), totalPrice: eligible.reduce((sum, l) => sum + l.price, 0) }
}
