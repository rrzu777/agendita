import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockRequireBusiness = vi.fn().mockResolvedValue({ businessId: 'biz-1' })
const mockFindMany = vi.fn()
const mockFindFirst = vi.fn()
const mockCount = vi.fn()

vi.mock('@/lib/auth/server', () => ({
  requireBusiness: (...args: unknown[]) => mockRequireBusiness(...args),
}))

vi.mock('@/lib/db', () => ({
  prisma: {
    booking: {
      findMany: (...args: unknown[]) => mockFindMany(...args),
      findFirst: (...args: unknown[]) => mockFindFirst(...args),
      count: (...args: unknown[]) => mockCount(...args),
    },
  },
}))

const {
  getBookingsPage,
  getBookingListStats,
  getPendingBookingTransfersPage,
  getManualPaymentBookings,
  searchManualPaymentBookings,
  getDashboardBookingSummary,
} = await import('@/server/actions/bookings')

describe('getBookingsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRequireBusiness.mockResolvedValue({ businessId: 'biz-1' })
  })

  it('returns one bounded page and a cursor from the final visible booking', async () => {
    mockFindMany.mockResolvedValue([
      { id: 'b-3' },
      { id: 'b-2' },
      { id: 'b-1' },
    ])

    const page = await getBookingsPage({ limit: 2 })

    expect(page.items.map((booking) => booking.id)).toEqual(['b-3', 'b-2'])
    expect(page.nextCursor).toBe('b-2')
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { businessId: 'biz-1' },
        take: 3,
        orderBy: [{ startDateTime: 'desc' }, { id: 'desc' }],
      }),
    )
  })

  it('does not reveal or traverse a cursor owned by another business', async () => {
    mockFindFirst.mockResolvedValue(null)

    const page = await getBookingsPage({ cursor: 'booking-other-business', limit: 2 })

    expect(page).toEqual({ items: [], nextCursor: null })
    expect(mockFindFirst).toHaveBeenCalledWith({
      where: { id: 'booking-other-business', businessId: 'biz-1' },
      select: { id: true },
    })
    expect(mockFindMany).not.toHaveBeenCalled()
  })
})

describe('getBookingListStats', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRequireBusiness.mockResolvedValue({ businessId: 'biz-1' })
  })

  it('derives dashboard counters in the database instead of from a rendered history page', async () => {
    mockCount
      .mockResolvedValueOnce(1200)
      .mockResolvedValueOnce(42)
      .mockResolvedValueOnce(8)
      .mockResolvedValueOnce(15)

    const now = new Date('2026-08-15T12:00:00Z')
    await expect(getBookingListStats(now)).resolves.toEqual({
      total: 1200,
      confirmed: 42,
      pendingPayment: 8,
      pendingConfirmation: 15,
    })

    expect(mockCount).toHaveBeenCalledWith({ where: { businessId: 'biz-1' } })
    expect(mockCount).toHaveBeenCalledWith({
      where: {
        businessId: 'biz-1',
        status: 'pending_payment',
        OR: [
          { holdExpiresAt: null },
          { holdExpiresAt: { gte: now } },
          { paymentStatus: { not: 'unpaid' } },
          { payments: { some: expect.any(Object) } },
        ],
      },
    })
  })
})

describe('getDashboardBookingSummary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRequireBusiness.mockResolvedValue({ businessId: 'biz-1' })
  })

  it('uses aggregates plus five upcoming rows instead of transferring booking history to the dashboard', async () => {
    mockCount
      .mockResolvedValueOnce(1240)
      .mockResolvedValueOnce(7)
      .mockResolvedValueOnce(19)
    mockFindMany.mockResolvedValue([{ id: 'soon-1' }])

    await expect(getDashboardBookingSummary(new Date('2026-08-15T15:00:00Z'), 'America/Santiago')).resolves.toMatchObject({
      total: 1240,
      today: 7,
      pendingTransfers: 19,
      upcoming: [{ id: 'soon-1' }],
    })

    expect(mockFindMany).toHaveBeenCalledWith(expect.objectContaining({
      take: 5,
      orderBy: [{ startDateTime: 'asc' }, { id: 'asc' }],
    }))
  })
})

describe('getPendingBookingTransfersPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRequireBusiness.mockResolvedValue({ businessId: 'biz-1' })
  })

  it('loads one bounded actionable transfer page instead of deriving it from every history row', async () => {
    mockFindMany.mockResolvedValue([{ id: 'transfer-3' }, { id: 'transfer-2' }, { id: 'transfer-1' }])

    await expect(getPendingBookingTransfersPage({ limit: 2 })).resolves.toMatchObject({
      items: [{ id: 'transfer-3' }, { id: 'transfer-2' }],
      nextCursor: 'transfer-2',
    })

    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          businessId: 'biz-1',
          status: { notIn: ['cancelled', 'expired'] },
          payments: { some: expect.any(Object) },
        }),
        take: 3,
        orderBy: [{ startDateTime: 'asc' }, { id: 'asc' }],
      }),
    )
  })
})

describe('getManualPaymentBookings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRequireBusiness.mockResolvedValue({ businessId: 'biz-1' })
  })

  it('bounds the initial selector without losing searchable reservations', async () => {
    mockFindMany.mockResolvedValue([])

    await getManualPaymentBookings()

    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          businessId: 'biz-1',
          remainingBalance: { gt: 0 },
          status: { in: ['pending_payment', 'confirmed', 'completed'] },
        },
        take: 50,
      }),
    )
  })

  it('searches eligible manual-payment reservations server-side', async () => {
    mockFindMany.mockResolvedValue([])

    await searchManualPaymentBookings(' Ana ')

    expect(mockFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        businessId: 'biz-1',
        OR: expect.arrayContaining([
          { customer: { is: { name: { contains: 'Ana', mode: 'insensitive' } } } },
          { customer: { is: { phone: { contains: 'Ana', mode: 'insensitive' } } } },
        ]),
      }),
      take: 25,
    }))
  })
})
