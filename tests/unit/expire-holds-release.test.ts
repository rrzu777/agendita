import { it, expect, vi } from 'vitest'
import { expireStaleHolds } from '@/lib/cron/expire-holds'
import { BookingStatus } from '@prisma/client'

it('releases redemptions of expired holds', async () => {
  const findMany = vi.fn().mockResolvedValueOnce([{ id: 'b1', businessId: 'biz1' }]) // expired bookings
  const tx = {
    booking: { updateMany: vi.fn().mockResolvedValue({ count: 1 }), findMany: vi.fn().mockResolvedValue([]) },
    payment: { findMany: vi.fn().mockResolvedValue([]), updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    promotionRedemption: {
      findMany: vi.fn().mockResolvedValue([{ bookingId: 'b1' }]),
      findUnique: vi.fn().mockResolvedValue({ id: 'r1', promotionId: 'p1', status: 'applied' }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    promotion: { updateMany: vi.fn().mockResolvedValue({ count: 1 }), findUnique: vi.fn().mockResolvedValue({ triggerType: 'code' }) },
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db: any = { booking: { findMany }, $transaction: (fn: any) => fn(tx) }
  const result = await expireStaleHolds(new Date(), db)

  expect(result.expired).toBe(1)
  expect(result.businessIds).toEqual(['biz1'])

  // The release set must come from a findMany that filters through the booking
  // relation on status === expired (excludes bookings that won the payment race).
  const relationCall = tx.promotionRedemption.findMany.mock.calls.find(
    (c) => c[0]?.where?.booking?.status === BookingStatus.expired,
  )
  expect(relationCall).toBeTruthy()
  expect(relationCall?.[0]?.where?.status).toBe('applied')

  // The release flips applied->released via updateMany on promotionRedemption
  // with releaseReason 'hold_expired'.
  const flipCall = tx.promotionRedemption.updateMany.mock.calls.find(
    (c) => c[0]?.data?.releaseReason === 'hold_expired',
  )
  expect(flipCall).toBeTruthy()
  // And the promo redemptionCount is decremented (with floor).
  expect(tx.promotion.updateMany).toHaveBeenCalled()
})

it('does NOT release a booking that won the payment race in the tx window', async () => {
  // Candidate set from the pre-tx findMany: both b1 and b2 looked stale.
  const findMany = vi.fn().mockResolvedValueOnce([
    { id: 'b1', businessId: 'biz1' },
    { id: 'b2', businessId: 'biz2' },
  ])
  const tx = {
    // Only ONE booking actually transitioned to expired; b2 won the payment
    // race (got confirmed/paid) and was re-excluded by the in-tx guard.
    booking: { updateMany: vi.fn().mockResolvedValue({ count: 1 }), findMany: vi.fn().mockResolvedValue([]) },
    payment: { findMany: vi.fn().mockResolvedValue([]), updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    promotionRedemption: {
      // The relation filter (booking.status === expired) returns ONLY b1.
      findMany: vi.fn().mockResolvedValue([{ bookingId: 'b1' }]),
      findUnique: vi.fn().mockResolvedValue({ id: 'r1', promotionId: 'p1', status: 'applied' }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    promotion: { updateMany: vi.fn().mockResolvedValue({ count: 1 }), findUnique: vi.fn().mockResolvedValue({ triggerType: 'code' }) },
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db: any = { booking: { findMany }, $transaction: (fn: any) => fn(tx) }
  await expireStaleHolds(new Date(), db)

  // b1 IS released.
  const releaseCalls = tx.promotionRedemption.updateMany.mock.calls.filter(
    (c) => c[0]?.data?.releaseReason === 'hold_expired',
  )
  expect(releaseCalls.some((c) => c[0]?.where?.bookingId === 'b1')).toBe(true)

  // b2 (the raced/paid booking) is NEVER touched by any release call — proving
  // the release set comes from the filtered findMany, not from expiredIds.
  const allReleaseWheres = tx.promotionRedemption.updateMany.mock.calls.map((c) => c[0]?.where)
  expect(allReleaseWheres.some((w) => w?.bookingId === 'b2')).toBe(false)
  // findUnique (the per-booking lookup inside releaseRedemptionForBooking) also
  // never runs for b2.
  expect(
    tx.promotionRedemption.findUnique.mock.calls.some((c) => c[0]?.where?.bookingId === 'b2'),
  ).toBe(false)
})
