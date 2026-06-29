import { describe, it, expect, vi } from 'vitest'
import { releaseRedemptionForBooking } from '@/lib/promotions/release'

function fakeTx(triggerType: string, grant: any) {
  return {
    promotionRedemption: {
      findUnique: vi.fn().mockResolvedValue({ promotionId: 'p1', status: 'applied' }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    promotion: {
      findUnique: vi.fn().mockResolvedValue({ triggerType }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    promotionGrant: {
      findFirst: vi.fn().mockResolvedValue(grant),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    loyaltyLedger: { create: vi.fn().mockResolvedValue({}) },
  } as any
}

describe('releaseRedemptionForBooking — grant-aware', () => {
  it('promo por código: decrementa redemptionCount (comportamiento de A)', async () => {
    const tx = fakeTx('code', null)
    await releaseRedemptionForBooking(tx, 'bk1', 'cancelled')
    expect(tx.promotion.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: { redemptionCount: { decrement: 1 } } }))
    expect(tx.promotionGrant.findFirst).not.toHaveBeenCalled()
  })
  it('grant: NO decrementa y reactiva la recompensa', async () => {
    const tx = fakeTx('granted', { id: 'g1', expiresAt: null, forfeitOnNoShow: false, refundOnExpiry: true, businessId: 'b1', customerId: 'c1', pointsSpent: 50 })
    await releaseRedemptionForBooking(tx, 'bk1', 'cancelled')
    expect(tx.promotion.updateMany).not.toHaveBeenCalled()
    expect(tx.promotionGrant.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'active', redeemedBookingId: null }) }))
  })
  it('no_show con forfeitOnNoShow: pierde la recompensa (no reactiva)', async () => {
    const tx = fakeTx('granted', { id: 'g1', expiresAt: null, forfeitOnNoShow: true })
    await releaseRedemptionForBooking(tx, 'bk1', 'no_show')
    expect(tx.promotionGrant.updateMany).not.toHaveBeenCalled()
  })
})
