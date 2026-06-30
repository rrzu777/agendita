import { describe, it, expect, vi, beforeEach } from 'vitest'
import { BookingStatus } from '@prisma/client'

const mockPrisma = {
  booking: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  review: {
    create: vi.fn(),
    findMany: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
    count: vi.fn(),
  },
  loyaltyConfig: {
    findUnique: vi.fn().mockResolvedValue(null),
  },
  // Premio por reseña (R-EMIT): tx aparte best-effort. Con loyaltyConfig null el
  // premio se short-circuita y nunca toca loadAutomaticRule/emit.
  $transaction: vi.fn(async (fn) => fn(mockPrisma)),
}

vi.mock('@/lib/db', () => ({
  prisma: mockPrisma,
}))

const mockCheckRateLimit = vi.fn().mockResolvedValue({ success: true })
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: mockCheckRateLimit,
}))

const mockRequireBusiness = vi.fn().mockResolvedValue({ businessId: 'biz-1', business: { id: 'biz-1' }, role: 'owner', user: {} })
const mockRequireBusinessRole = vi.fn().mockResolvedValue({ businessId: 'biz-1', business: { id: 'biz-1' }, role: 'owner', user: {} })
vi.mock('@/lib/auth/server', () => ({
  requireBusiness: mockRequireBusiness,
  requireBusinessRole: mockRequireBusinessRole,
  ForbiddenError: class ForbiddenError extends Error { constructor(msg?: string) { super(msg || 'Forbidden') } },
}))

const mockRevalidatePath = vi.fn()
vi.mock('next/cache', () => ({
  revalidatePath: mockRevalidatePath,
}))

vi.mock('next/headers', () => ({
  headers: vi.fn().mockResolvedValue(new Map([
    ['host', 'agendita.app'],
    ['x-forwarded-proto', 'https'],
  ])),
}))

vi.mock('@/server/actions/revalidate-business', () => ({
  revalidateBusinessPublicPaths: vi.fn().mockResolvedValue(undefined),
}))

const {
  getReviewRequest,
  submitReview,
  getDashboardReviews,
  getPendingReviewCount,
  getCompletedBookingsWithoutReview,
  approveReview,
  hideReview,
  ensureReviewTokenForBooking,
  getReviewLink,
  getReviewWhatsappLink,
} = await import('@/server/actions/reviews')

const completedBooking = {
  id: 'booking-1',
  businessId: 'biz-1',
  customerId: 'cust-1',
  serviceId: 'svc-1',
  status: BookingStatus.completed,
  reviewToken: 'token-abc-123',
  startDateTime: new Date('2026-05-20T14:00:00Z'),
  endDateTime: new Date('2026-05-20T15:00:00Z'),
  totalPrice: 10000,
  depositRequired: 5000,
  depositPaid: 10000,
  remainingBalance: 0,
  finalAmount: 10000,
  discountAmount: 0,
  paymentStatus: 'fully_paid' as const,
  holdExpiresAt: null,
  idempotencyKey: null,
  customerNotes: null,
  internalNotes: null,
  reviewTokenCreatedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  business: { name: 'Negocio Test' },
  service: { name: 'Corte de pelo' },
}

describe('getReviewRequest', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns null for invalid token', async () => {
    mockPrisma.booking.findUnique.mockResolvedValue({
      ...completedBooking,
      reviewToken: 'correct-token',
    })

    const result = await getReviewRequest('booking-1', 'wrong-token')
    expect(result).toBeNull()
  })

  it('returns null for non-existent booking', async () => {
    mockPrisma.booking.findUnique.mockResolvedValue(null)

    const result = await getReviewRequest('nonexistent', 'token')
    expect(result).toBeNull()
  })

  it('throws for non-completed booking', async () => {
    mockPrisma.booking.findUnique.mockResolvedValue({
      ...completedBooking,
      status: BookingStatus.confirmed,
    })

    await expect(getReviewRequest('booking-1', 'token-abc-123')).rejects.toThrow('aún no ha sido completada')
  })

  it('returns alreadyReviewed true when review exists', async () => {
    mockPrisma.booking.findUnique.mockResolvedValue({
      ...completedBooking,
      review: { id: 'review-1' },
    })

    const result = await getReviewRequest('booking-1', 'token-abc-123')
    expect(result).not.toBeNull()
    expect(result!.alreadyReviewed).toBe(true)
    expect(result!.businessName).toBeDefined()
  })

  it('returns alreadyReviewed false when no review exists', async () => {
    mockPrisma.booking.findUnique.mockResolvedValue({
      ...completedBooking,
      review: null,
    })

    const result = await getReviewRequest('booking-1', 'token-abc-123')
    expect(result).not.toBeNull()
    expect(result!.alreadyReviewed).toBe(false)
    expect(result!.businessName).toBeDefined()
    expect(result!.serviceName).toBeDefined()
  })
})

describe('submitReview', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rejects with invalid token', async () => {
    mockPrisma.booking.findUnique.mockResolvedValue({
      ...completedBooking,
      reviewToken: 'correct-token',
      review: null,
    })

    await expect(
      submitReview({ bookingId: 'booking-1', token: 'wrong-token', rating: 4 })
    ).rejects.toThrow('Link de reseña inválido')
  })

  it('rejects non-completed booking', async () => {
    mockPrisma.booking.findUnique.mockResolvedValue({
      ...completedBooking,
      status: BookingStatus.confirmed,
      review: null,
    })

    await expect(
      submitReview({ bookingId: 'booking-1', token: 'token-abc-123', rating: 4 })
    ).rejects.toThrow('Solo puedes dejar reseña para reservas completadas')
  })

  it('rejects duplicate review', async () => {
    mockPrisma.booking.findUnique.mockResolvedValue({
      ...completedBooking,
      review: { id: 'review-1' },
    })

    await expect(
      submitReview({ bookingId: 'booking-1', token: 'token-abc-123', rating: 4 })
    ).rejects.toThrow('Ya enviaste una reseña')
  })

  it('handles concurrent P2002 duplicate gracefully', async () => {
    mockPrisma.booking.findUnique.mockResolvedValue({
      ...completedBooking,
      review: null,
    })

    const p2002Error = new Error('Unique constraint violation') as Error & { code: string }
    p2002Error.code = 'P2002'
    mockPrisma.review.create.mockRejectedValue(p2002Error)

    await expect(
      submitReview({ bookingId: 'booking-1', token: 'token-abc-123', rating: 4 })
    ).rejects.toThrow('Ya enviaste una reseña para esta reserva')
  })

  it('re-throws non-P2002 errors', async () => {
    mockPrisma.booking.findUnique.mockResolvedValue({
      ...completedBooking,
      review: null,
    })

    mockPrisma.review.create.mockRejectedValue(new Error('DB connection error'))

    await expect(
      submitReview({ bookingId: 'booking-1', token: 'token-abc-123', rating: 4 })
    ).rejects.toThrow('DB connection error')
  })

  it('creates review with correct businessId/customerId from booking', async () => {
    mockPrisma.booking.findUnique.mockResolvedValue({
      ...completedBooking,
      review: null,
    })

    mockPrisma.review.create.mockResolvedValue({
      id: 'review-new',
      businessId: 'biz-1',
      bookingId: 'booking-1',
      customerId: 'cust-1',
      rating: 4,
      comment: null,
      isApproved: false,
      isHidden: false,
      createdAt: new Date(),
    })

    const result = await submitReview({ bookingId: 'booking-1', token: 'token-abc-123', rating: 4 })

    expect(mockPrisma.review.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          businessId: 'biz-1',
          customerId: 'cust-1',
          bookingId: 'booking-1',
          rating: 4,
          isApproved: false,
          isHidden: false,
        }),
      })
    )

    expect(result.businessId).toBe('biz-1')
    expect(result.customerId).toBe('cust-1')
    expect(result.isApproved).toBe(false)
    expect(result.isHidden).toBe(false)
  })

  it('creates review with comment', async () => {
    mockPrisma.booking.findUnique.mockResolvedValue({
      ...completedBooking,
      review: null,
    })

    mockPrisma.review.create.mockResolvedValue({
      id: 'review-new',
      businessId: 'biz-1',
      bookingId: 'booking-1',
      customerId: 'cust-1',
      rating: 5,
      comment: 'Muy buen servicio',
      isApproved: false,
      isHidden: false,
      createdAt: new Date(),
    })

    const result = await submitReview({
      bookingId: 'booking-1',
      token: 'token-abc-123',
      rating: 5,
      comment: 'Muy buen servicio',
    })

    expect(result.comment).toBe('Muy buen servicio')
  })

  it('does not accept businessId/customerId from client input', async () => {
    mockPrisma.booking.findUnique.mockResolvedValue({
      ...completedBooking,
      review: null,
    })

    mockPrisma.review.create.mockResolvedValue({
      id: 'review-new',
      businessId: 'biz-1',
      bookingId: 'booking-1',
      customerId: 'cust-1',
      rating: 3,
      comment: null,
      isApproved: false,
      isHidden: false,
      createdAt: new Date(),
    })

    await submitReview({
      bookingId: 'booking-1',
      token: 'token-abc-123',
      rating: 3,
    })

    expect(mockPrisma.review.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          businessId: 'biz-1',
          customerId: 'cust-1',
        }),
      })
    )
  })

  it('rejects invalid rating', async () => {
    await expect(
      submitReview({ bookingId: 'booking-1', token: 'token-abc-123', rating: 0 })
    ).rejects.toThrow('Datos inválidos')
  })
})

describe('getDashboardReviews', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns reviews for authenticated business', async () => {
    mockRequireBusiness.mockResolvedValue({ businessId: 'biz-1', business: { id: 'biz-1' }, role: 'owner', user: {} })

    const mockReviews = [
      {
        id: 'review-1',
        rating: 5,
        comment: 'Genial',
        isApproved: true,
        isHidden: false,
        createdAt: new Date(),
        customer: { id: 'cust-1', name: 'Maria' },
        booking: { id: 'b-1', startDateTime: new Date(), service: { name: 'Corte' } },
      },
    ]
    mockPrisma.review.findMany.mockResolvedValue(mockReviews)

    const result = await getDashboardReviews()

    expect(mockPrisma.review.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { businessId: 'biz-1' },
        orderBy: { createdAt: 'desc' },
      })
    )
    expect(result).toEqual(mockReviews)
  })

  it('includes customer.id in response', async () => {
    mockRequireBusiness.mockResolvedValue({ businessId: 'biz-1', business: { id: 'biz-1' }, role: 'owner', user: {} })

    mockPrisma.review.findMany.mockResolvedValue([
      {
        id: 'review-1',
        rating: 5,
        comment: 'Genial',
        isApproved: true,
        isHidden: false,
        createdAt: new Date(),
        customer: { id: 'cust-1', name: 'Maria' },
        booking: { id: 'b-1', startDateTime: new Date(), service: { name: 'Corte' } },
      },
    ])

    const result = await getDashboardReviews()
    expect(result[0].customer.id).toBe('cust-1')
  })

  it('filters by pending status', async () => {
    mockRequireBusiness.mockResolvedValue({ businessId: 'biz-1', business: { id: 'biz-1' }, role: 'owner', user: {} })
    mockPrisma.review.findMany.mockResolvedValue([])

    await getDashboardReviews({ status: 'pending' })

    expect(mockPrisma.review.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { businessId: 'biz-1', isApproved: false, isHidden: false },
      })
    )
  })

  it('filters by approved status', async () => {
    mockRequireBusiness.mockResolvedValue({ businessId: 'biz-1', business: { id: 'biz-1' }, role: 'owner', user: {} })
    mockPrisma.review.findMany.mockResolvedValue([])

    await getDashboardReviews({ status: 'approved' })

    expect(mockPrisma.review.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { businessId: 'biz-1', isApproved: true, isHidden: false },
      })
    )
  })

  it('filters by hidden status', async () => {
    mockRequireBusiness.mockResolvedValue({ businessId: 'biz-1', business: { id: 'biz-1' }, role: 'owner', user: {} })
    mockPrisma.review.findMany.mockResolvedValue([])

    await getDashboardReviews({ status: 'hidden' })

    expect(mockPrisma.review.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { businessId: 'biz-1', isHidden: true },
      })
    )
  })

  it('filters by rating', async () => {
    mockRequireBusiness.mockResolvedValue({ businessId: 'biz-1', business: { id: 'biz-1' }, role: 'owner', user: {} })
    mockPrisma.review.findMany.mockResolvedValue([])

    await getDashboardReviews({ rating: 5 })

    expect(mockPrisma.review.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { businessId: 'biz-1', rating: 5 },
      })
    )
  })

  it('"all" status does not add filter conditions', async () => {
    mockRequireBusiness.mockResolvedValue({ businessId: 'biz-1', business: { id: 'biz-1' }, role: 'owner', user: {} })
    mockPrisma.review.findMany.mockResolvedValue([])

    await getDashboardReviews({ status: 'all' })

    const callArgs = mockPrisma.review.findMany.mock.calls[0][0]
    expect(callArgs.where.isApproved).toBeUndefined()
    expect(callArgs.where.isHidden).toBeUndefined()
  })

  it('searches by customer name', async () => {
    mockRequireBusiness.mockResolvedValue({ businessId: 'biz-1', business: { id: 'biz-1' }, role: 'owner', user: {} })
    mockPrisma.review.findMany.mockResolvedValue([])

    await getDashboardReviews({ search: 'Maria' })

    const callArgs = mockPrisma.review.findMany.mock.calls[0][0]
    expect(callArgs.where.OR).toBeDefined()
    expect(callArgs.where.OR).toContainEqual(
      expect.objectContaining({ customer: { name: { contains: 'Maria', mode: 'insensitive' } } })
    )
  })

  it('searches by comment', async () => {
    mockRequireBusiness.mockResolvedValue({ businessId: 'biz-1', business: { id: 'biz-1' }, role: 'owner', user: {} })
    mockPrisma.review.findMany.mockResolvedValue([])

    await getDashboardReviews({ search: 'excelente' })

    const callArgs = mockPrisma.review.findMany.mock.calls[0][0]
    expect(callArgs.where.OR).toBeDefined()
    expect(callArgs.where.OR).toContainEqual(
      expect.objectContaining({ comment: { contains: 'excelente', mode: 'insensitive' } } )
    )
  })

  it('searches by service name via booking relation', async () => {
    mockRequireBusiness.mockResolvedValue({ businessId: 'biz-1', business: { id: 'biz-1' }, role: 'owner', user: {} })
    mockPrisma.review.findMany.mockResolvedValue([])

    await getDashboardReviews({ search: 'Corte' })

    const callArgs = mockPrisma.review.findMany.mock.calls[0][0]
    expect(callArgs.where.OR).toBeDefined()
    expect(callArgs.where.OR).toContainEqual(
      expect.objectContaining({ booking: { service: { name: { contains: 'Corte', mode: 'insensitive' } } } })
    )
  })

  it('search combines with status filter', async () => {
    mockRequireBusiness.mockResolvedValue({ businessId: 'biz-1', business: { id: 'biz-1' }, role: 'owner', user: {} })
    mockPrisma.review.findMany.mockResolvedValue([])

    await getDashboardReviews({ status: 'approved', search: 'Maria' })

    const callArgs = mockPrisma.review.findMany.mock.calls[0][0]
    expect(callArgs.where.isApproved).toBe(true)
    expect(callArgs.where.isHidden).toBe(false)
    expect(callArgs.where.OR).toBeDefined()
  })

  it('empty search does not add OR', async () => {
    mockRequireBusiness.mockResolvedValue({ businessId: 'biz-1', business: { id: 'biz-1' }, role: 'owner', user: {} })
    mockPrisma.review.findMany.mockResolvedValue([])

    await getDashboardReviews({ search: '' })

    const callArgs = mockPrisma.review.findMany.mock.calls[0][0]
    expect(callArgs.where.OR).toBeUndefined()
  })

  it('whitespace-only search does not add OR', async () => {
    mockRequireBusiness.mockResolvedValue({ businessId: 'biz-1', business: { id: 'biz-1' }, role: 'owner', user: {} })
    mockPrisma.review.findMany.mockResolvedValue([])

    await getDashboardReviews({ search: '   ' })

    const callArgs = mockPrisma.review.findMany.mock.calls[0][0]
    expect(callArgs.where.OR).toBeUndefined()
  })
})

describe('getPendingReviewCount', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns count of pending reviews', async () => {
    mockRequireBusiness.mockResolvedValue({ businessId: 'biz-1', business: { id: 'biz-1' }, role: 'owner', user: {} })
    mockPrisma.review.count.mockResolvedValue(3)

    const result = await getPendingReviewCount()

    expect(mockPrisma.review.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { businessId: 'biz-1', isApproved: false, isHidden: false },
      })
    )
    expect(result).toBe(3)
  })
})

describe('getCompletedBookingsWithoutReview', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns completed bookings without review', async () => {
    mockRequireBusiness.mockResolvedValue({ businessId: 'biz-1', business: { id: 'biz-1' }, role: 'owner', user: {} })

    const mockBookings = [
      {
        id: 'booking-1',
        startDateTime: new Date('2026-05-20T14:00:00Z'),
        reviewToken: null,
        customer: { id: 'cust-1', name: 'Maria' },
        service: { name: 'Corte' },
      },
    ]
    mockPrisma.booking.findMany.mockResolvedValue(mockBookings)

    const result = await getCompletedBookingsWithoutReview()

    expect(mockPrisma.booking.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          businessId: 'biz-1',
          status: BookingStatus.completed,
          review: null,
        },
        orderBy: { startDateTime: 'desc' },
        take: 20,
      })
    )
    expect(result).toEqual(mockBookings)
    expect(result[0].customer.id).toBe('cust-1')
  })
})

describe('approveReview', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('approves a pending review', async () => {
    mockRequireBusinessRole.mockResolvedValue({ businessId: 'biz-1', business: { id: 'biz-1' }, role: 'owner', user: {} })

    mockPrisma.review.findUnique.mockResolvedValue({
      id: 'review-1',
      businessId: 'biz-1',
      isApproved: false,
      isHidden: false,
    })

    mockPrisma.review.update.mockResolvedValue({
      id: 'review-1',
      businessId: 'biz-1',
      bookingId: 'b-1',
      customerId: 'c-1',
      rating: 5,
      comment: null,
      isApproved: true,
      isHidden: false,
      createdAt: new Date(),
    })

    const result = await approveReview('review-1')

    expect(result.isApproved).toBe(true)
    expect(result.isHidden).toBe(false)
    expect(mockPrisma.review.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'review-1' },
        data: { isApproved: true, isHidden: false },
      })
    )
  })

  it('rejects review from another business', async () => {
    mockRequireBusinessRole.mockResolvedValue({ businessId: 'biz-1', business: { id: 'biz-1' }, role: 'owner', user: {} })

    mockPrisma.review.findUnique.mockResolvedValue({
      id: 'review-1',
      businessId: 'biz-2',
      isApproved: false,
      isHidden: false,
    })

    await expect(approveReview('review-1')).rejects.toThrow('Reseña no encontrada')
  })

  it('rejects review that does not exist', async () => {
    mockRequireBusinessRole.mockResolvedValue({ businessId: 'biz-1', business: { id: 'biz-1' }, role: 'owner', user: {} })
    mockPrisma.review.findUnique.mockResolvedValue(null)

    await expect(approveReview('review-1')).rejects.toThrow('Reseña no encontrada')
  })
})

describe('hideReview', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('hides an approved review', async () => {
    mockRequireBusinessRole.mockResolvedValue({ businessId: 'biz-1', business: { id: 'biz-1' }, role: 'owner', user: {} })

    mockPrisma.review.findUnique.mockResolvedValue({
      id: 'review-1',
      businessId: 'biz-1',
      isApproved: true,
      isHidden: false,
    })

    mockPrisma.review.update.mockResolvedValue({
      id: 'review-1',
      businessId: 'biz-1',
      bookingId: 'b-1',
      customerId: 'c-1',
      rating: 5,
      comment: null,
      isApproved: false,
      isHidden: true,
      createdAt: new Date(),
    })

    const result = await hideReview('review-1')

    expect(result.isHidden).toBe(true)
    expect(result.isApproved).toBe(false)
    expect(mockPrisma.review.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'review-1' },
        data: { isApproved: false, isHidden: true },
      })
    )
  })

  it('rejects review from another business', async () => {
    mockRequireBusinessRole.mockResolvedValue({ businessId: 'biz-1', business: { id: 'biz-1' }, role: 'owner', user: {} })

    mockPrisma.review.findUnique.mockResolvedValue({
      id: 'review-1',
      businessId: 'biz-2',
      isApproved: true,
      isHidden: false,
    })

    await expect(hideReview('review-1')).rejects.toThrow('Reseña no encontrada')
  })
})

describe('ensureReviewTokenForBooking', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('requires owner/admin role', async () => {
    mockRequireBusinessRole.mockResolvedValue({ businessId: 'biz-1', business: { id: 'biz-1' }, role: 'owner', user: {} })

    mockPrisma.booking.findFirst.mockResolvedValue({
      ...completedBooking,
      reviewToken: 'existing-token',
    })

    await ensureReviewTokenForBooking('booking-1')

    expect(mockRequireBusinessRole).toHaveBeenCalledWith(['owner', 'admin'])
  })

  it('rejects booking from another business', async () => {
    mockRequireBusinessRole.mockResolvedValue({ businessId: 'biz-1', business: { id: 'biz-1' }, role: 'owner', user: {} })
    mockPrisma.booking.findFirst.mockResolvedValue(null)

    await expect(ensureReviewTokenForBooking('booking-other')).rejects.toThrow('Reserva no encontrada')
  })

  it('rejects non-completed booking', async () => {
    mockRequireBusinessRole.mockResolvedValue({ businessId: 'biz-1', business: { id: 'biz-1' }, role: 'owner', user: {} })

    mockPrisma.booking.findFirst.mockResolvedValue({
      ...completedBooking,
      status: BookingStatus.confirmed,
      reviewToken: null,
    })

    await expect(ensureReviewTokenForBooking('booking-1')).rejects.toThrow(
      'Solo puedes generar link de reseña para reservas completadas'
    )
  })

  it('returns existing token if already exists', async () => {
    mockRequireBusinessRole.mockResolvedValue({ businessId: 'biz-1', business: { id: 'biz-1' }, role: 'owner', user: {} })

    mockPrisma.booking.findFirst.mockResolvedValue({
      ...completedBooking,
      reviewToken: 'existing-token',
    })

    const result = await ensureReviewTokenForBooking('booking-1')

    expect(result).toBe('existing-token')
    expect(mockPrisma.booking.update).not.toHaveBeenCalled()
  })

  it('generates new token with crypto.randomUUID', async () => {
    mockRequireBusinessRole.mockResolvedValue({ businessId: 'biz-1', business: { id: 'biz-1' }, role: 'owner', user: {} })

    mockPrisma.booking.findFirst.mockResolvedValue({
      ...completedBooking,
      reviewToken: null,
    })

    // Atomic claim succeeds (count 1) → the generated token is returned directly.
    mockPrisma.booking.updateMany.mockResolvedValue({ count: 1 })

    const cryptoSpy = vi.spyOn(crypto, 'randomUUID').mockReturnValue('new-generated-token')

    const result = await ensureReviewTokenForBooking('booking-1')

    expect(result).toBe('new-generated-token')
    expect(mockPrisma.booking.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'booking-1', businessId: 'biz-1', reviewToken: null },
        data: expect.objectContaining({ reviewToken: 'new-generated-token' }),
      })
    )

    cryptoSpy.mockRestore()
  })
})

describe('getReviewLink', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns null for non-completed booking', async () => {
    mockRequireBusinessRole.mockResolvedValue({ businessId: 'biz-1', business: { id: 'biz-1' }, role: 'owner', user: {} })

    mockPrisma.booking.findFirst.mockResolvedValue({
      id: 'booking-1',
      reviewToken: null,
      status: BookingStatus.confirmed,
    })

    const result = await getReviewLink('booking-1')
    expect(result).toBeNull()
  })

  it('returns null when no token exists', async () => {
    mockRequireBusinessRole.mockResolvedValue({ businessId: 'biz-1', business: { id: 'biz-1' }, role: 'owner', user: {} })

    mockPrisma.booking.findFirst.mockResolvedValue({
      id: 'booking-1',
      reviewToken: null,
      status: BookingStatus.completed,
    })

    const result = await getReviewLink('booking-1')
    expect(result).toBeNull()
  })

  it('returns review URL with token', async () => {
    mockRequireBusinessRole.mockResolvedValue({ businessId: 'biz-1', business: { id: 'biz-1' }, role: 'owner', user: {} })

    mockPrisma.booking.findFirst.mockResolvedValue({
      id: 'booking-1',
      reviewToken: 'token-abc-123',
      status: BookingStatus.completed,
    })

    const result = await getReviewLink('booking-1')
    expect(result).toBe('https://agendita.app/review/booking-1?token=token-abc-123')
  })

  it('requires owner/admin role', async () => {
    mockRequireBusinessRole.mockResolvedValue({ businessId: 'biz-1', business: { id: 'biz-1' }, role: 'owner', user: {} })

    mockPrisma.booking.findFirst.mockResolvedValue({
      id: 'booking-1',
      reviewToken: 'token-abc-123',
      status: BookingStatus.completed,
    })

    await getReviewLink('booking-1')

    expect(mockRequireBusinessRole).toHaveBeenCalledWith(['owner', 'admin'])
  })
})

describe('getReviewWhatsappLink', () => {
  beforeEach(() => {
    mockRequireBusinessRole.mockResolvedValue({ businessId: 'biz-1', business: { id: 'biz-1' }, role: 'owner', user: {} })
  })

  it('builds a wa.me URL with normalized phone and the review link', async () => {
    mockPrisma.booking.findFirst.mockResolvedValue({
      id: 'booking-1',
      status: BookingStatus.completed,
      reviewToken: 'tok-1',
      customer: { name: 'Ana Pérez', phone: '+56 9 1234 5678' },
      business: { name: 'Mimos Nails' },
    })

    const result = await getReviewWhatsappLink('booking-1')

    expect(result).not.toBeNull()
    expect(result!.reviewLink).toBe('https://agendita.app/review/booking-1?token=tok-1')
    expect(result!.waUrl).toContain('https://wa.me/56912345678?text=')
    expect(decodeURIComponent(result!.waUrl!)).toContain('https://agendita.app/review/booking-1?token=tok-1')
    expect(decodeURIComponent(result!.waUrl!)).toContain('Ana') // saludo con primer nombre
  })

  it('prepends country code for a 9-digit local number', async () => {
    mockPrisma.booking.findFirst.mockResolvedValue({
      id: 'booking-1',
      status: BookingStatus.completed,
      reviewToken: 'tok-1',
      customer: { name: 'Ana', phone: '912345678' },
      business: { name: 'Mimos Nails' },
    })

    const result = await getReviewWhatsappLink('booking-1')
    expect(result!.waUrl).toContain('https://wa.me/56912345678?text=')
  })

  it('returns waUrl null (link only) when the customer has no phone', async () => {
    mockPrisma.booking.findFirst.mockResolvedValue({
      id: 'booking-1',
      status: BookingStatus.completed,
      reviewToken: 'tok-1',
      customer: { name: 'Ana', phone: null },
      business: { name: 'Mimos Nails' },
    })

    const result = await getReviewWhatsappLink('booking-1')
    expect(result!.waUrl).toBeNull()
    expect(result!.reviewLink).toBe('https://agendita.app/review/booking-1?token=tok-1')
  })

  it('returns null for a booking that is not completed', async () => {
    mockPrisma.booking.findFirst.mockResolvedValue({
      id: 'booking-1',
      status: BookingStatus.confirmed,
      reviewToken: null,
      customer: { name: 'Ana', phone: '912345678' },
      business: { name: 'Mimos Nails' },
    })

    const result = await getReviewWhatsappLink('booking-1')
    expect(result).toBeNull()
  })
})
