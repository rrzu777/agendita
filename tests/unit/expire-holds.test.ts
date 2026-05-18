import { describe, it, expect, vi } from 'vitest'
import { expireStaleHolds } from '@/lib/cron/expire-holds'
import { BookingStatus } from '@prisma/client'

describe('expireStaleHolds', () => {
  function makeDb(overrides: Record<string, unknown> = {}) {
    return {
      booking: {
        findMany: vi.fn().mockResolvedValue(overrides.findMany ?? []),
        updateMany: vi.fn().mockResolvedValue(overrides.updateMany ?? { count: 0 }),
      },
    } as unknown as Parameters<typeof expireStaleHolds>[1]
  }

  it('returns 0 when no stale holds exist', async () => {
    const db = makeDb()
    const result = await expireStaleHolds(new Date(), db)

    expect(result.expired).toBe(0)
    expect(result.businessIds).toEqual([])
    expect(db.booking.updateMany).not.toHaveBeenCalled()
  })

  it('expires stale holds and returns count', async () => {
    const db = makeDb({
      findMany: [
        { id: 'b1', businessId: 'biz-1' },
        { id: 'b2', businessId: 'biz-1' },
      ],
      updateMany: { count: 2 },
    })

    const now = new Date('2026-05-20T12:00:00Z')
    const result = await expireStaleHolds(now, db)

    expect(result.expired).toBe(2)
    expect(result.businessIds).toEqual(['biz-1'])
    expect(db.booking.updateMany).toHaveBeenCalledWith({
      where: {
        id: { in: ['b1', 'b2'] },
        status: BookingStatus.pending_payment,
        paymentStatus: 'unpaid',
        holdExpiresAt: { lt: now },
      },
      data: { status: BookingStatus.expired },
    })
  })

  it('reports lower count if a race occurred (payment processed between find and update)', async () => {
    const db = makeDb({
      findMany: [
        { id: 'b1', businessId: 'biz-1' },
        { id: 'b2', businessId: 'biz-1' },
      ],
      updateMany: { count: 1 },
    })

    const result = await expireStaleHolds(new Date(), db)

    expect(result.expired).toBe(1)
    expect(result.businessIds).toEqual(['biz-1'])
  })

  it('deduplicates businessIds for revalidation', async () => {
    const db = makeDb({
      findMany: [
        { id: 'b1', businessId: 'biz-1' },
        { id: 'b2', businessId: 'biz-2' },
        { id: 'b3', businessId: 'biz-1' },
      ],
      updateMany: { count: 3 },
    })

    const result = await expireStaleHolds(new Date(), db)

    expect(result.businessIds).toEqual(['biz-1', 'biz-2'])
  })
})
