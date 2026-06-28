import { describe, it, expect, vi } from 'vitest'
import {
  releaseRedemptionForBooking,
  reconcileRedemptionCount,
} from '@/lib/promotions/release'

function tx(redemption: any, flippedCount = 1) {
  return {
    promotionRedemption: {
      findUnique: vi.fn().mockResolvedValue(redemption),
      updateMany: vi.fn().mockResolvedValue({ count: flippedCount }),
    },
    promotion: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
  } as any
}

describe('releaseRedemptionForBooking', () => {
  it('releases an applied redemption and decrements with a floor', async () => {
    const t = tx({ id: 'r1', promotionId: 'p1', status: 'applied' })
    await releaseRedemptionForBooking(t, 'b1', 'cancelled')
    expect(t.promotionRedemption.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { bookingId: 'b1', status: 'applied' },
      data: expect.objectContaining({ status: 'released', releaseReason: 'cancelled' }),
    }))
    expect(t.promotion.updateMany).toHaveBeenCalledWith({
      where: { id: 'p1', redemptionCount: { gt: 0 } },
      data: { redemptionCount: { decrement: 1 } },
    })
  })
  it('does nothing when there is no redemption', async () => {
    const t = tx(null)
    await releaseRedemptionForBooking(t, 'b1', 'cancelled')
    expect(t.promotionRedemption.updateMany).not.toHaveBeenCalled()
  })
  it('does nothing when already released', async () => {
    const t = tx({ id: 'r1', promotionId: 'p1', status: 'released' })
    await releaseRedemptionForBooking(t, 'b1', 'no_show')
    expect(t.promotionRedemption.updateMany).not.toHaveBeenCalled()
  })
  it('does not decrement when it loses the flip race', async () => {
    const t = tx({ id: 'r1', promotionId: 'p1', status: 'applied' }, 0)
    await releaseRedemptionForBooking(t, 'b1', 'cancelled')
    expect(t.promotionRedemption.updateMany).toHaveBeenCalled()
    expect(t.promotion.updateMany).not.toHaveBeenCalled()
  })
})

describe('reconcileRedemptionCount', () => {
  it('sets redemptionCount to the applied-canje count and returns it', async () => {
    const db = {
      promotionRedemption: { count: vi.fn().mockResolvedValue(3) },
      promotion: { update: vi.fn().mockResolvedValue({}) },
    } as any
    const result = await reconcileRedemptionCount(db, 'p1')
    expect(result).toBe(3)
    expect(db.promotionRedemption.count).toHaveBeenCalledWith({
      where: { promotionId: 'p1', status: 'applied' },
    })
    expect(db.promotion.update).toHaveBeenCalledWith({
      where: { id: 'p1' },
      data: { redemptionCount: 3 },
    })
  })
})
