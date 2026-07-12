import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockPrisma = {
  booking: {
    findUnique: vi.fn(),
  },
  payment: {
    findFirst: vi.fn().mockResolvedValue(null),
    create: vi.fn(),
    update: vi.fn(),
  },
}

vi.mock('@/lib/db', () => ({
  prisma: mockPrisma,
}))

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ success: true }),
}))

vi.mock('@/lib/payments/factory', () => ({
  getDefaultProvider: vi.fn(),
  resolveOnlinePaymentAvailability: vi.fn(),
  getOnlinePaymentProviderForBusiness: vi.fn(),
  resolveOnlinePaymentAvailabilityForBusiness: vi.fn(),
}))

vi.mock('@/lib/business/urls', () => ({
  getBusinessPublicUrl: vi.fn().mockReturnValue('https://test.com'),
}))

vi.mock('@/lib/payments/derive-payment-type', () => ({
  deriveManualPaymentType: vi.fn(),
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

vi.mock('@/server/actions/revalidate-business', () => ({
  revalidateBusinessPublicPaths: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/auth/server', () => ({
  requireBusiness: vi.fn().mockResolvedValue({ businessId: 'biz-1' }),
  requireBusinessRole: vi.fn().mockResolvedValue({ businessId: 'biz-1' }),
  ForbiddenError: class extends Error {},
}))

vi.mock('@/lib/notifications', () => ({
  sendBookingConfirmedNotification: vi.fn(),
  sendNotificationSafely: vi.fn().mockResolvedValue({ success: true }),
}))

vi.mock('@/lib/logger', () => ({
  logger: {
    payment: { initiated: vi.fn(), approved: vi.fn() },
    booking: { created: vi.fn(), error: vi.fn() },
    error: vi.fn(),
  },
}))

const { initiatePayment } = await import('@/server/actions/payments')
const { resolveOnlinePaymentAvailabilityForBusiness, getOnlinePaymentProviderForBusiness } = await import('@/lib/payments/factory')

describe('initiatePayment - amount guards', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rejects when computed amount is 0 (depositRequired=0, remainingBalance>0)', async () => {
    mockPrisma.booking.findUnique.mockResolvedValue({
      id: 'booking-1',
      businessId: 'biz-1',
      customerId: 'cust-1',
      depositRequired: 0,
      remainingBalance: 15000,
      paymentStatus: 'unpaid',
      status: 'pending_payment',
      holdExpiresAt: new Date(Date.now() + 100000),
      service: { name: 'Manicure' },
      business: {
        slug: 'test',
        subdomain: null,
        currency: 'CLP',
        id: 'biz-1',
      },
      customer: { email: 'test@test.com' },
    })
    vi.mocked(resolveOnlinePaymentAvailabilityForBusiness).mockResolvedValue({
      available: true,
      provider: 'mock',
      isMock: true,
    })
    vi.mocked(getOnlinePaymentProviderForBusiness).mockResolvedValue({
      name: 'mock',
      createPayment: vi.fn().mockResolvedValue({ paymentId: 'p-1' }),
      verifyPayment: vi.fn(),
      handleWebhook: vi.fn(),
      refundPayment: vi.fn(),
    })

    await expect(
      initiatePayment({ bookingId: 'booking-1', amount: 15000, currency: 'CLP' }),
    ).rejects.toThrow('No se requiere pago para esta reserva')
  })

  it('rejects when depositRequired is positive but booking is fully_paid', async () => {
    mockPrisma.booking.findUnique.mockResolvedValue({
      id: 'booking-2',
      businessId: 'biz-1',
      customerId: 'cust-1',
      depositRequired: 5000,
      remainingBalance: 0,
      paymentStatus: 'fully_paid',
      status: 'confirmed',
      holdExpiresAt: null,
      service: { name: 'Manicure' },
      business: {
        slug: 'test',
        subdomain: null,
        currency: 'CLP',
        id: 'biz-1',
      },
      customer: { email: null },
    })

    await expect(
      initiatePayment({ bookingId: 'booking-2' }),
    ).rejects.toThrow('La reserva ya está pagada')
  })
})
