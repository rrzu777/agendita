import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ForbiddenError } from '../helpers/auth-errors'

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
  getBookingConfirmationUrl: vi.fn().mockReturnValue('https://test.com/booking-confirmation'),
}))

vi.mock('@/lib/payments/derive-payment-type', () => ({
  deriveManualPaymentType: vi.fn(),
}))

const createMpPreferenceForPayment = vi.fn()
vi.mock('@/lib/payments/create-preference', () => ({
  createMpPreferenceForPayment: (...args: unknown[]) => createMpPreferenceForPayment(...args),
  getPaymentAppUrl: () => 'https://app.test',
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
  ForbiddenError,
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
    process.env.MERCADO_PAGO_ENVIRONMENT = 'production'
    mockPrisma.payment.findFirst.mockResolvedValue(null)
    mockPrisma.payment.create.mockResolvedValue({ id: 'pay-production' })
    createMpPreferenceForPayment.mockResolvedValue({ redirectUrl: 'https://mp.test/production' })
  })

  function setPayableMercadoPagoBooking() {
    mockPrisma.booking.findUnique.mockResolvedValue({
      id: 'booking-mp',
      businessId: 'biz-1',
      customerId: 'cust-1',
      depositRequired: 5000,
      remainingBalance: 10000,
      paymentStatus: 'unpaid',
      status: 'pending_payment',
      holdExpiresAt: new Date(Date.now() + 100000),
      service: { name: 'Manicure' },
      business: { slug: 'test', subdomain: null, currency: 'CLP', id: 'biz-1' },
      customer: { email: 'test@test.com' },
    })
    vi.mocked(resolveOnlinePaymentAvailabilityForBusiness).mockResolvedValue({
      available: true,
      provider: 'mercado_pago',
      isMock: false,
    })
    vi.mocked(getOnlinePaymentProviderForBusiness).mockResolvedValue({
      name: 'mercado_pago',
      createPayment: vi.fn(),
      verifyPayment: vi.fn(),
      handleWebhook: vi.fn(),
      refundPayment: vi.fn(),
    })
  }

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

    const res = await initiatePayment({ bookingId: 'booking-1', amount: 15000, currency: 'CLP' })
    expect(res.ok).toBe(false)
    if (res.ok) throw new Error('expected error result')
    expect(res.error).toBe('No se requiere pago para esta reserva')
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

    const res = await initiatePayment({ bookingId: 'booking-2' })
    expect(res.ok).toBe(false)
    if (res.ok) throw new Error('expected error result')
    expect(res.error).toBe('La reserva ya está pagada')
  })

  it('does not reuse a sandbox pending payment for a production initiation', async () => {
    setPayableMercadoPagoBooking()
    mockPrisma.payment.findFirst.mockImplementation(({ where }) =>
      where.providerEnvironment === 'production' ? null : { id: 'pay-sandbox' },
    )

    const res = await initiatePayment({ bookingId: 'booking-mp' })

    expect(res.ok).toBe(true)
    expect(mockPrisma.payment.findFirst).toHaveBeenCalledWith({
      where: expect.objectContaining({
        provider: 'mercado_pago',
        providerEnvironment: 'production',
        status: 'pending',
      }),
    })
    expect(mockPrisma.payment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ providerEnvironment: 'production' }),
    })
    expect(createMpPreferenceForPayment.mock.calls[0][1].localPaymentId).toBe('pay-production')
  })

  it('reuses a pending Mercado Pago payment in the same environment', async () => {
    setPayableMercadoPagoBooking()
    mockPrisma.payment.findFirst.mockImplementation(({ where }) =>
      where.providerEnvironment === 'production' ? { id: 'pay-production-existing' } : null,
    )

    const res = await initiatePayment({ bookingId: 'booking-mp' })

    expect(res.ok).toBe(true)
    expect(mockPrisma.payment.create).not.toHaveBeenCalled()
    expect(createMpPreferenceForPayment.mock.calls[0][1].localPaymentId).toBe('pay-production-existing')
  })

  it('fails closed before pending lookup when Mercado Pago environment is missing', async () => {
    setPayableMercadoPagoBooking()
    delete process.env.MERCADO_PAGO_ENVIRONMENT

    const res = await initiatePayment({ bookingId: 'booking-mp' })

    expect(res.ok).toBe(false)
    expect(mockPrisma.payment.findFirst).not.toHaveBeenCalled()
    expect(mockPrisma.payment.create).not.toHaveBeenCalled()
  })
})
