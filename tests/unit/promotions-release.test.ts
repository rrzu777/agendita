import { describe, it, expect, vi } from 'vitest'
import { releaseRedemptionForBooking } from '@/lib/promotions/release'

function tx(redemption: any) {
  return {
    promotionRedemption: {
      findUnique: vi.fn().mockResolvedValue(redemption),
      update: vi.fn().mockResolvedValue({}),
    },
    promotion: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
  } as any
}

describe('releaseRedemptionForBooking', () => {
  it('releases an applied redemption and decrements with a floor', async () => {
    const t = tx({ id: 'r1', promotionId: 'p1', status: 'applied' })
    await releaseRedemptionForBooking(t, 'b1', 'cancelled')
    expect(t.promotionRedemption.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'r1' },
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
    expect(t.promotionRedemption.update).not.toHaveBeenCalled()
  })
  it('does nothing when already released', async () => {
    const t = tx({ id: 'r1', promotionId: 'p1', status: 'released' })
    await releaseRedemptionForBooking(t, 'b1', 'no_show')
    expect(t.promotion.updateMany).not.toHaveBeenCalled()
  })
})
