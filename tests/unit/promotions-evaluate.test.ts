import { describe, it, expect } from 'vitest'
import { computeDiscount, isRedeemable } from '@/lib/promotions/evaluate'

const now = new Date('2026-07-01T12:00:00Z')
function promo(over: Partial<Parameters<typeof isRedeemable>[0]['promo']> = {}) {
  return {
    isActive: true, validFrom: null, validUntil: null,
    maxRedemptions: null, maxPerCustomer: null, minSpend: null,
    appliesToAll: true, serviceIds: [] as string[],
    rewardType: 'percentage' as const, rewardValue: 20, maxDiscount: null,
    redemptionCount: 0, ...over,
  }
}

describe('computeDiscount', () => {
  it('percentage floors', () => {
    expect(computeDiscount(promo({ rewardValue: 15 }), 19990)).toBe(2998) // floor(2998.5)
  })
  it('percentage respects maxDiscount', () => {
    expect(computeDiscount(promo({ rewardValue: 50, maxDiscount: 5000 }), 20000)).toBe(5000)
  })
  it('fixed never exceeds total', () => {
    expect(computeDiscount(promo({ rewardType: 'fixed_amount', rewardValue: 30000 }), 20000)).toBe(20000)
  })
  it('free_service discounts the full total', () => {
    expect(computeDiscount(promo({ rewardType: 'free_service', rewardValue: 0 }), 20000)).toBe(20000)
  })
  it('never returns a negative discount on a negative price', () => {
    expect(computeDiscount(promo({ rewardType: 'fixed_amount', rewardValue: 5000 }), -1000)).toBe(0)
  })
  it('percentage on zero total is zero', () => {
    expect(computeDiscount(promo({ rewardType: 'percentage', rewardValue: 50 }), 0)).toBe(0)
  })
  it('free_service on zero total is zero', () => {
    expect(computeDiscount(promo({ rewardType: 'free_service', rewardValue: 0 }), 0)).toBe(0)
  })
})

describe('isRedeemable', () => {
  const ctx = { serviceId: 'svc1', totalPrice: 20000, customerRedemptions: 0, now }
  it('ok by default', () => {
    expect(isRedeemable({ promo: promo(), ...ctx }).ok).toBe(true)
  })
  it('blocks inactive', () => {
    expect(isRedeemable({ promo: promo({ isActive: false }), ...ctx }).ok).toBe(false)
  })
  it('blocks outside window', () => {
    expect(isRedeemable({ promo: promo({ validUntil: new Date('2026-06-30T00:00:00Z') }), ...ctx }).ok).toBe(false)
  })
  it('blocks when sold out', () => {
    expect(isRedeemable({ promo: promo({ maxRedemptions: 5, redemptionCount: 5 }), ...ctx }).ok).toBe(false)
  })
  it('allows unlimited (maxRedemptions null)', () => {
    expect(isRedeemable({ promo: promo({ maxRedemptions: null, redemptionCount: 999 }), ...ctx }).ok).toBe(true)
  })
  it('blocks when customer over per-customer cap', () => {
    expect(isRedeemable({ promo: promo({ maxPerCustomer: 1 }), ...ctx, customerRedemptions: 1 }).ok).toBe(false)
  })
  it('blocks below minSpend', () => {
    expect(isRedeemable({ promo: promo({ minSpend: 25000 }), ...ctx }).ok).toBe(false)
  })
  it('blocks service out of scope', () => {
    expect(isRedeemable({ promo: promo({ appliesToAll: false, serviceIds: ['other'] }), ...ctx }).ok).toBe(false)
  })
  it('allows service in scope', () => {
    expect(isRedeemable({ promo: promo({ appliesToAll: false, serviceIds: ['svc1'] }), ...ctx }).ok).toBe(true)
  })
})
