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
    const { prisma } = await import('@/lib/db')
    const start = new Date('2026-05-01')
    const end = new Date('2026-05-31')

    const result = await getBookingsByRange(start, end)

    expect(result.length).toBe(1)
    expect(result[0].id).toBe('b1')
    expect(prisma.booking.findMany).toHaveBeenCalledWith({
      where: {
        businessId: 'biz-1',
        startDateTime: { gte: start, lte: end },
      },
      orderBy: { startDateTime: 'asc' },
      include: {
        service: true,
        customer: true,
      },
    })
  })
})
