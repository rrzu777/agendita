import { describe, it, expect, vi, beforeEach } from 'vitest'
import { BookingStatus, BookingPaymentStatus } from '@prisma/client'

// Mocks de dependencias server-only
const mockPrisma = {
  business: { findUnique: vi.fn() },
  service: { findFirst: vi.fn() },
  booking: {
    findUnique: vi.fn(),
    create: vi.fn(),
  },
  customer: {
    findFirst: vi.fn(),
    create: vi.fn(),
  },
  businessUser: {
    findMany: vi.fn().mockResolvedValue([
      { user: { email: 'owner@test.com', name: 'Owner' } },
    ]),
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

const mockResendSend = vi.fn()
const MockResend = vi.fn(function (this: Record<string, unknown>) {
  this.emails = { send: mockResendSend }
}) as unknown as { new (...args: unknown[]): { emails: { send: typeof mockResendSend } } }

vi.mock('resend', () => ({
  Resend: MockResend,
}))

vi.mock('@/lib/notifications', () => ({
  sendBookingConfirmationToCustomer: vi.fn(),
  sendBookingReceivedToCustomer: vi.fn(),
  sendNewBookingNotificationToBusiness: vi.fn().mockResolvedValue([]),
  sendBookingCancelledNotification: vi.fn(),
  sendNotificationSafely: vi.fn().mockResolvedValue({ success: true }),
  sendMultiNotificationSafely: vi.fn().mockResolvedValue([]),
}))

vi.mock('@/lib/availability/validation', () => ({
  assertSlotIsAvailable: vi.fn().mockResolvedValue(undefined),
}))

// Import DESPUÉS de los mocks
const { createBooking } = await import('@/server/actions/bookings')

describe('createBooking idempotency', () => {
  const baseInput = {
    serviceId: 'svc-1',
    customerName: 'Juan',
    customerPhone: '+56912345678',
    startDateTime: new Date('2026-05-20T14:00:00Z'),
    idempotencyKey: 'key-abc-123',
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('RESEND_API_KEY', '')
    vi.stubEnv('FROM_EMAIL', '')
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
    })
    mockPrisma.service.findFirst.mockResolvedValue({
      id: 'svc-1',
      businessId: 'biz-1',
      price: 10000,
      depositAmount: 5000,
      durationMinutes: 60,
      isActive: true,
    })
    mockPrisma.customer.findFirst.mockResolvedValue(null)
    mockPrisma.customer.create.mockResolvedValue({ id: 'cust-1' })
  })

  it('returns existing booking when idempotencyKey already exists', async () => {
    const existingBooking = {
      id: 'booking-1',
      businessId: 'biz-1',
      serviceId: 'svc-1',
      status: BookingStatus.pending_payment,
    }
    mockPrisma.booking.findUnique.mockResolvedValue(existingBooking)

    const result = await createBooking(baseInput, 'biz-1')

    expect(result).toEqual(existingBooking)
    expect(mockPrisma.$transaction).not.toHaveBeenCalled()
    expect(mockPrisma.booking.create).not.toHaveBeenCalled()
  })

  it('creates new booking when idempotencyKey is new', async () => {
    mockPrisma.booking.findUnique.mockResolvedValue(null)
    const createdBooking = {
      id: 'booking-new',
      businessId: 'biz-1',
      serviceId: 'svc-1',
      customerId: 'cust-1',
      status: BookingStatus.pending_payment,
      totalPrice: 10000,
      depositRequired: 5000,
      depositPaid: 0,
      remainingBalance: 10000,
      finalAmount: 10000,
      paymentStatus: BookingPaymentStatus.unpaid,
      startDateTime: new Date('2026-05-20T14:00:00Z'),
      endDateTime: new Date('2026-05-20T15:00:00Z'),
      service: { name: 'Manicure' },
      customer: { name: 'Juan', phone: '+56912345678', email: null },
    }
    mockPrisma.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => {
      const tx = {
        ...mockPrisma,
        booking: { ...mockPrisma.booking, create: vi.fn().mockResolvedValue(createdBooking) },
      }
      return fn(tx)
    })

    const result = await createBooking(baseInput, 'biz-1')

    expect(result).toEqual(createdBooking)
    expect(mockPrisma.booking.findUnique).toHaveBeenCalledWith({
      where: {
        businessId_idempotencyKey: {
          businessId: 'biz-1',
          idempotencyKey: 'key-abc-123',
        },
      },
      include: { service: true, customer: true },
    })
  })

  it('handles race condition by returning existing booking on P2002', async () => {
    mockPrisma.booking.findUnique.mockResolvedValueOnce(null)
    const existingBooking = {
      id: 'booking-race',
      businessId: 'biz-1',
      serviceId: 'svc-1',
    }
    mockPrisma.booking.findUnique.mockResolvedValueOnce(existingBooking)

    // Simular que $transaction lanza P2002 por unique constraint
    const p2002Error = new Error('Unique constraint failed') as Error & { code: string; meta?: unknown }
    p2002Error.code = 'P2002'
    p2002Error.meta = { target: ['businessId_idempotencyKey'] }
    mockPrisma.$transaction.mockRejectedValue(p2002Error)

    const result = await createBooking(baseInput, 'biz-1')

    expect(result).toEqual(existingBooking)
  })

  it('re-throws non-idempotency errors', async () => {
    mockPrisma.booking.findUnique.mockResolvedValue(null)
    const genericError = new Error('DB connection lost') as Error & { code: string }
    genericError.code = 'P1001'
    mockPrisma.$transaction.mockRejectedValue(genericError)

    await expect(createBooking(baseInput, 'biz-1')).rejects.toThrow('DB connection lost')
  })

  it('works without idempotencyKey (backward compatible)', async () => {
    const inputWithoutKey = { ...baseInput, idempotencyKey: undefined }
    mockPrisma.booking.findUnique.mockResolvedValue(null)
    const createdBooking = {
      id: 'booking-no-key',
      businessId: 'biz-1',
      serviceId: 'svc-1',
      customerId: 'cust-1',
      status: BookingStatus.pending_payment,
      totalPrice: 10000,
      depositRequired: 5000,
      depositPaid: 0,
      remainingBalance: 10000,
      finalAmount: 10000,
      paymentStatus: BookingPaymentStatus.unpaid,
      startDateTime: new Date('2026-05-20T14:00:00Z'),
      endDateTime: new Date('2026-05-20T15:00:00Z'),
      service: { name: 'Manicure' },
      customer: { name: 'Juan', phone: '+56912345678', email: null },
    }
    mockPrisma.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => {
      const tx = {
        ...mockPrisma,
        booking: { ...mockPrisma.booking, create: vi.fn().mockResolvedValue(createdBooking) },
      }
      return fn(tx)
    })

    const result = await createBooking(inputWithoutKey, 'biz-1')

    expect(result).toEqual(createdBooking)
    expect(mockPrisma.booking.findUnique).not.toHaveBeenCalled()
  })
})
