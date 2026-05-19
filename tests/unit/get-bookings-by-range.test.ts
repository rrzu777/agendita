import { describe, it, expect, vi } from 'vitest'
import { getBookingsByRange } from '@/server/actions/bookings'

vi.mock('@/lib/auth/server', () => ({
  requireBusiness: vi.fn().mockResolvedValue({ businessId: 'biz-1' }),
}))

vi.mock('@/lib/db', () => ({
  prisma: {
    booking: {
      findMany: vi.fn().mockResolvedValue([
        { id: 'b1', status: 'confirmed', startDateTime: new Date('2026-05-18T10:00:00Z') },
      ]),
    },
  },
}))

describe('getBookingsByRange', () => {
  it('returns bookings filtered by business and date range', async () => {
    const result = await getBookingsByRange(
      new Date('2026-05-01'),
      new Date('2026-05-31')
    )
    expect(result.length).toBe(1)
    expect(result[0].id).toBe('b1')
  })
})
