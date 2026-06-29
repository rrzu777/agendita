import { describe, it, expect, vi } from 'vitest'
import { applyPromotionInTx } from '@/lib/promotions/apply'

function tx(promo: any, opts: { incCount?: number } = {}) {
  return {
    promotionGrant: { findFirst: vi.fn().mockResolvedValue(null) },
    promotion: {
      findFirst: vi.fn().mockResolvedValue(promo),
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: opts.incCount ?? 1 }),
    },
    promotionRedemption: { count: vi.fn().mockResolvedValue(0), create: vi.fn().mockResolvedValue({}) },
  } as any
}
const P = { id: 'p1', code: 'V20', triggerType: 'code', isActive: true, validFrom: null, validUntil: null, maxRedemptions: null, maxPerCustomer: null, minSpend: null, appliesToAll: true, rewardType: 'percentage', rewardValue: 20, maxDiscount: null, redemptionCount: 0, services: [] }
const baseArgs = { businessId: 'b1', serviceId: 'svc1', customerId: 'c1', totalPrice: 20000, bookingId: 'bk1', source: 'public_booking' as const }

describe('applyPromotionInTx', () => {
  it('returns null when no code', async () => {
    expect(await applyPromotionInTx(tx(null), { ...baseArgs, code: '' })).toBeNull()
  })
  it('throws on unknown code (booking must not be created)', async () => {
    await expect(applyPromotionInTx(tx(null), { ...baseArgs, code: 'NOPE' })).rejects.toThrow('no es válido')
  })
  it('applies a 20% discount and inserts a redemption', async () => {
    const t = tx(P)
    const res = await applyPromotionInTx(t, { ...baseArgs, code: 'V20' })
    expect(res).toEqual({ discountAmount: 4000, promotionId: 'p1' })
    expect(t.promotionRedemption.create).toHaveBeenCalled()
  })
  it('throws when the atomic increment loses the race (sold out)', async () => {
    const t = tx({ ...P, maxRedemptions: 5 }, { incCount: 0 })
    await expect(applyPromotionInTx(t, { ...baseArgs, code: 'V20' })).rejects.toThrow('ya no está disponible')
  })
})
