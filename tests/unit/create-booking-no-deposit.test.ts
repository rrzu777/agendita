import { describe, it, expect, vi, beforeEach } from 'vitest'
import { BookingStatus, BookingPaymentStatus } from '@prisma/client'

const mockPrisma = {
  business: { findUnique: vi.fn() },
  service: { findFirst: vi.fn() },
  booking: {
    findUnique: vi.fn().mockResolvedValue(null),
    create: vi.fn(),
  },
  customer: {
    findFirst: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue({ id: 'cust-1', name: 'Juan', phone: '+56912345678', email: null }),
  },
  $transaction: vi.fn(),
}

vi.mock('@/lib/db', () => ({
  prisma: mockPrisma,
}))

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ success: true }),
}))

vi.mock('@/lib/auth/server', () => ({
  requireBusiness: vi.fn().mockResolvedValue({ businessId: 'biz-1' }),
  requireBusinessRole: vi.fn().mockResolvedValue({ businessId: 'biz-1' }),
  ForbiddenError: class extends Error {},
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

vi.mock('@/server/actions/revalidate-business', () => ({
  revalidateBusinessPublicPaths: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('resend', () => ({
  Resend: vi.fn(function (this: Record<string, unknown>) {
    this.emails = { send: vi.fn().mockResolvedValue({ id: 'msg-1' }) }
  }),
}))

vi.mock('@/lib/notifications', () => ({
  getBusinessReplyToEmail: vi.fn().mockResolvedValue('owner@test.com'),
  sendBookingConfirmationToCustomer: vi.fn(),
  sendBookingReceivedToCustomer: vi.fn(),
  sendNewBookingNotificationToBusiness: vi.fn().mockResolvedValue([]),
  sendBookingCancelledNotification: vi.fn(),
  sendBookingConfirmedNotification: vi.fn(),
  sendNotificationSafely: vi.fn().mockResolvedValue({ success: true }),
  sendMultiNotificationSafely: vi.fn().mockResolvedValue([]),
}))

vi.mock('@/lib/availability/validation', () => ({
  assertSlotIsAvailable: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/subscriptions/enforcement', () => ({
  assertBusinessCanReceiveBookings: vi.fn(),
}))

const { createBooking } = await import('@/server/actions/bookings')

function setupMocks(depositAmount: number, servicePrice: number) {
  mockPrisma.business.findUnique.mockResolvedValue({
    id: 'biz-1',
    timezone: 'America/Santiago',
    name: 'Test Business',
    whatsapp: '+56987654321',
    addressText: 'Test Address',
    currency: 'CLP',
    cancellationPolicy: null,
    slug: 'test-biz',
    subdomain: null,
    subscriptionStatus: 'active',
  })
  mockPrisma.service.findFirst.mockResolvedValue({
    id: 'svc-1',
    name: 'Manicure',
    price: servicePrice,
    depositAmount,
    durationMinutes: 60,
    isActive: true,
  })
  const createBookingResult = {
    id: 'booking-created',
    customer: { name: 'Juan', phone: '+56912345678', email: null },
    service: { name: 'Manicure' },
  }
  mockPrisma.booking.create.mockResolvedValue(createBookingResult)
  mockPrisma.$transaction.mockImplementation(async (fn: Function) => {
    const tx = {
      business: { findUnique: mockPrisma.business.findUnique },
      service: { findFirst: mockPrisma.service.findFirst },
      booking: { create: mockPrisma.booking.create },
      customer: {
        findFirst: mockPrisma.customer.findFirst,
        create: mockPrisma.customer.create,
      },
      timeBlock: { findFirst: mockPrisma.timeBlock?.findFirst || vi.fn().mockResolvedValue(null) },
      availabilityRule: {
        findFirst: vi.fn().mockResolvedValue({
          startTime: '08:00',
          endTime: '20:00',
        }),
      },
      $executeRaw: vi.fn(),
      $queryRaw: vi.fn().mockResolvedValue([]),
    }
    return fn(tx)
  })
}

describe('createBooking - no deposit / free service', () => {
  const baseInput = {
    serviceId: 'svc-1',
    customerName: 'Juan',
    customerPhone: '+56912345678',
    startDateTime: new Date('2026-06-15T14:00:00Z'),
    acceptedTerms: true,
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('creates confirmed + unpaid + hold null when depositRequired=0 and price>0', async () => {
    setupMocks(0, 20000)

    await createBooking(baseInput, 'biz-1')

    const createCall = mockPrisma.booking.create.mock.calls[0]?.[0] as Record<string, unknown>
    const data = createCall?.data as Record<string, unknown>
    expect(data.status).toBe(BookingStatus.confirmed)
    expect(data.paymentStatus).toBe(BookingPaymentStatus.unpaid)
    expect(data.holdExpiresAt).toBeNull()
    expect(data.depositPaid).toBe(0)
    expect(data.remainingBalance).toBe(20000)
    expect(data.finalAmount).toBe(20000)
  })

  it('creates confirmed + fully_paid + hold null when service is free', async () => {
    setupMocks(0, 0)

    await createBooking(baseInput, 'biz-1')

    const createCall = mockPrisma.booking.create.mock.calls[0]?.[0] as Record<string, unknown>
    const data = createCall?.data as Record<string, unknown>
    expect(data.status).toBe(BookingStatus.confirmed)
    expect(data.paymentStatus).toBe(BookingPaymentStatus.fully_paid)
    expect(data.holdExpiresAt).toBeNull()
    expect(data.depositPaid).toBe(0)
    expect(data.remainingBalance).toBe(0)
  })

  it('creates pending_payment + unpaid + hold set when depositRequired>0', async () => {
    setupMocks(5000, 20000)

    await createBooking(baseInput, 'biz-1')

    const createCall = mockPrisma.booking.create.mock.calls[0]?.[0] as Record<string, unknown>
    const data = createCall?.data as Record<string, unknown>
    expect(data.status).toBe(BookingStatus.pending_payment)
    expect(data.paymentStatus).toBe(BookingPaymentStatus.unpaid)
    expect(data.holdExpiresAt).not.toBeNull()
    expect(data.depositRequired).toBe(5000)
  })

  it('rejects when acceptedTerms is false', async () => {
    setupMocks(0, 20000)

    await expect(
      createBooking({ ...baseInput, acceptedTerms: false }, 'biz-1'),
    ).rejects.toThrow(/aceptar los términos/)
  })

  it('rejects when service is not found', async () => {
    mockPrisma.business.findUnique.mockResolvedValue({
      id: 'biz-1',
      timezone: 'America/Santiago',
      name: 'Test Business',
      whatsapp: null,
      addressText: null,
      currency: 'CLP',
      cancellationPolicy: null,
      slug: 'test-biz',
      subdomain: null,
      subscriptionStatus: 'active',
    })
    mockPrisma.service.findFirst.mockResolvedValue(null)

    await expect(createBooking(baseInput, 'biz-1')).rejects.toThrow(/Servicio no disponible/)
  })

  it('honors idempotencyKey and returns existing booking', async () => {
    setupMocks(5000, 20000)
    const existingBooking = { id: 'booking-existing', service: { name: 'Manicure' }, customer: { name: 'Juan', phone: '+56912345678', email: null } }
    mockPrisma.booking.findUnique.mockResolvedValueOnce(existingBooking)

    const result = await createBooking({ ...baseInput, idempotencyKey: 'key-1' }, 'biz-1')

    expect(result).toBe(existingBooking)
    expect(mockPrisma.booking.create).not.toHaveBeenCalled()
  })
})
