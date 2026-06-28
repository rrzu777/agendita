import { it, expect, vi } from 'vitest'
import { expireStaleHolds } from '@/lib/cron/expire-holds'

it('releases redemptions of expired holds', async () => {
  const findMany = vi.fn().mockResolvedValueOnce([{ id: 'b1', businessId: 'biz1' }]) // expired bookings
  const tx = {
    booking: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    promotionRedemption: {
      findMany: vi.fn().mockResolvedValue([{ bookingId: 'b1' }]),
      findUnique: vi.fn().mockResolvedValue({ id: 'r1', promotionId: 'p1', status: 'applied' }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    promotion: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db: any = { booking: { findMany }, $transaction: (fn: any) => fn(tx) }
  const result = await expireStaleHolds(new Date(), db)

  expect(result.expired).toBe(1)
  expect(result.businessIds).toEqual(['biz1'])

  // The release flips applied->released via updateMany on promotionRedemption
  // with releaseReason 'hold_expired'.
  const flipCall = tx.promotionRedemption.updateMany.mock.calls.find(
    (c) => c[0]?.data?.releaseReason === 'hold_expired',
  )
  expect(flipCall).toBeTruthy()
  // And the promo redemptionCount is decremented (with floor).
  expect(tx.promotion.updateMany).toHaveBeenCalled()
})
