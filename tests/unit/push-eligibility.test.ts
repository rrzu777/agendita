import { BookingStatus } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/push/config', () => ({ hasUsablePushConfig: () => true }))

const NOW = new Date('2026-08-11T12:00:00.000Z')
const HOUR_MS = 60 * 60 * 1000

function booking(overrides: Record<string, unknown> = {}) {
  return {
    startDateTime: new Date(NOW.getTime() + 72 * HOUR_MS),
    status: BookingStatus.confirmed,
    cancellationCutoffHours: 24,
    depositRequired: 5_000,
    depositPaid: 0,
    ...overrides,
  }
}

const business = {
  cancellationReminderEnabled: true,
  selfServiceCutoffHours: 24,
}

describe('push activation eligibility', () => {
  beforeEach(() => vi.clearAllMocks())

  it('closes the activation window at the exact effective cutoff boundary', async () => {
    const { isPushBookingEligible } = await import('@/lib/push/eligibility')

    expect(isPushBookingEligible(booking({
      startDateTime: new Date(NOW.getTime() + 24 * HOUR_MS + 1),
    }), business, NOW)).toBe(true)
    expect(isPushBookingEligible(booking({
      startDateTime: new Date(NOW.getTime() + 24 * HOUR_MS),
    }), business, NOW)).toBe(false)
    expect(isPushBookingEligible(booking({
      startDateTime: new Date(NOW.getTime() + 24 * HOUR_MS - 1),
    }), business, NOW)).toBe(false)
  })

  it('uses the business fallback for legacy snapshots and rejects unsafe cutoff arithmetic', async () => {
    const { isPushBookingEligible } = await import('@/lib/push/eligibility')

    expect(isPushBookingEligible(booking({
      cancellationCutoffHours: null,
      startDateTime: new Date(NOW.getTime() + 24 * HOUR_MS),
    }), business, NOW)).toBe(false)
    expect(isPushBookingEligible(booking({
      cancellationCutoffHours: Number.MAX_SAFE_INTEGER,
    }), business, NOW)).toBe(false)
  })

  it('filters closed-window customers after the broad Prisma candidate query', async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        id: 'closed-customer',
        businessId: 'business-1',
        business,
        bookings: [booking({
          startDateTime: new Date(NOW.getTime() + 24 * HOUR_MS),
        })],
      },
      {
        id: 'open-customer',
        businessId: 'business-1',
        business,
        bookings: [booking({
          startDateTime: new Date(NOW.getTime() + 24 * HOUR_MS + 1),
        })],
      },
    ])
    const { findEligiblePushCustomers } = await import('@/lib/push/eligibility')

    await expect(findEligiblePushCustomers({ customer: { findMany } }, 'user-1', NOW))
      .resolves.toEqual([{ id: 'open-customer', businessId: 'business-1' }])
  })
})
