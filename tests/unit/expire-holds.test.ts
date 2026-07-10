import { describe, it, expect, vi } from 'vitest'
import { expireStaleHolds } from '@/lib/cron/expire-holds'
import { BookingStatus } from '@prisma/client'

describe('expireStaleHolds', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function makeDb(overrides: Record<string, any> = {}): any {
    // tx.booking.updateMany is the one whose result drives `expired`.
    const updateMany = vi.fn().mockResolvedValue(overrides.updateMany ?? { count: 0 })
    const tx = {
      // booking.findMany (post-updateMany) = qué reservas transicionaron a expired;
      // [] por defecto = ninguna transferencia declarada que cancelar.
      booking: { updateMany, findMany: vi.fn().mockResolvedValue(overrides.expiredNow ?? []) },
      payment: {
        findMany: vi.fn().mockResolvedValue([]),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      promotionRedemption: {
        // No applied redemptions on the expired holds by default.
        findMany: vi.fn().mockResolvedValue([]),
        findUnique: vi.fn().mockResolvedValue(null),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      promotion: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    }
    return {
      booking: {
        findMany: vi.fn().mockResolvedValue(overrides.findMany ?? []),
        // Exposed so assertions can target the booking.updateMany inside the tx.
        updateMany,
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      $transaction: (fn: any) => fn(tx),
    }
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
