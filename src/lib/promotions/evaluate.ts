export interface PromoCore {
  isActive: boolean
  validFrom: Date | null
  validUntil: Date | null
  maxRedemptions: number | null
  maxPerCustomer: number | null
  minSpend: number | null
  appliesToAll: boolean
  serviceIds: string[]
  rewardType: 'percentage' | 'fixed_amount' | 'free_service'
  rewardValue: number
  maxDiscount: number | null
  redemptionCount: number
}

export function computeDiscount(promo: PromoCore, totalPrice: number): number {
  const cap = Math.max(0, totalPrice)
  if (promo.rewardType === 'percentage') {
    const raw = Math.floor((cap * promo.rewardValue) / 100)
    return Math.min(Math.max(0, raw), promo.maxDiscount ?? Infinity, cap)
  }
  if (promo.rewardType === 'fixed_amount') {
    return Math.min(Math.max(0, promo.rewardValue), cap)
  }
  return cap // free_service
}

export type RedeemReason =
  | 'inactive' | 'not_started' | 'expired' | 'sold_out'
  | 'per_customer_cap' | 'min_spend' | 'out_of_scope'

export function isRedeemable(input: {
  promo: PromoCore
  serviceId: string
  totalPrice: number
  customerRedemptions: number
  now: Date
}): { ok: true; discount: number } | { ok: false; reason: RedeemReason } {
  const { promo, serviceId, totalPrice, customerRedemptions, now } = input
  if (!promo.isActive) return { ok: false, reason: 'inactive' }
  if (promo.validFrom && now < promo.validFrom) return { ok: false, reason: 'not_started' }
  if (promo.validUntil && now > promo.validUntil) return { ok: false, reason: 'expired' }
  if (promo.maxRedemptions != null && promo.redemptionCount >= promo.maxRedemptions) return { ok: false, reason: 'sold_out' }
  if (promo.maxPerCustomer != null && customerRedemptions >= promo.maxPerCustomer) return { ok: false, reason: 'per_customer_cap' }
  if (promo.minSpend != null && totalPrice < promo.minSpend) return { ok: false, reason: 'min_spend' }
  if (!promo.appliesToAll && !(promo.serviceIds ?? []).includes(serviceId)) return { ok: false, reason: 'out_of_scope' }
  return { ok: true, discount: computeDiscount(promo, totalPrice) }
}
