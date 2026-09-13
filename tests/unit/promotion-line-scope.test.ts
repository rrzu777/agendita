import { describe, expect, it } from 'vitest'
import { promotionLineScope } from '@/lib/promotions/line-scope'
const lines = [{ serviceId: 'cut', price: 15000 }, { serviceId: 'nose', price: 4000 }]
describe('promotion scope for a service selection', () => {
  it('percentage and fixed discounts use only covered services', () => {
    expect(promotionLineScope({ appliesToAll: false, serviceIds: ['nose'], rewardType: 'percentage' }, lines)).toEqual({ serviceIds: ['nose'], totalPrice: 4000 })
    expect(promotionLineScope({ appliesToAll: true, serviceIds: [], rewardType: 'fixed_amount' }, lines)).toEqual({ serviceIds: ['cut', 'nose'], totalPrice: 19000 })
  })
  it('a free-service reward covers one selected service, not the entire appointment', () => {
    expect(promotionLineScope({ appliesToAll: true, serviceIds: [], rewardType: 'free_service' }, lines)).toEqual({ serviceIds: ['cut'], totalPrice: 15000 })
  })
  it('returns no eligible base for an unrelated reward', () => {
    expect(promotionLineScope({ appliesToAll: false, serviceIds: ['other'], rewardType: 'free_service' }, lines)).toEqual({ serviceIds: [], totalPrice: 0 })
  })
  it('skips free add-ons and does not redeem a wholly free selection', () => {
    const promo = { appliesToAll: true, serviceIds: [], rewardType: 'free_service' as const }
    expect(promotionLineScope(promo, [{ serviceId: 'free', price: 0 }, ...lines])).toEqual({ serviceIds: ['cut'], totalPrice: 15000 })
    expect(promotionLineScope(promo, [{ serviceId: 'free', price: 0 }])).toEqual({ serviceIds: [], totalPrice: 0 })
  })
})
