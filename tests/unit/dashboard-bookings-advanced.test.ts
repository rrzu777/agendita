import { describe, it, expect, vi, beforeEach } from 'vitest'
import { BookingPaymentStatus, BookingStatus, PaymentType } from '@prisma/client'

const mockApplyApprovedPayment = vi.fn()
const mockAssertSlotIsAvailable = vi.fn()

const mockPrisma = {
  service: { findFirst: vi.fn() },
  booking: { create: vi.fn() },
  customer: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
  payment: { create: vi.fn() },
  $transaction: vi.fn(),
}

vi.mock('@/lib/db', () => ({ prisma: mockPrisma }))

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ success: true }),
}))

vi.mock('@/lib/auth/server', () => ({
  requireBusiness: vi.fn().mockResolvedValue({ businessId: 'biz-1' }),
  requireBusinessRole: vi.fn().mockResolvedValue({
    businessId: 'biz-1',
    business: { timezone: 'America/Santiago', currency: 'CLP' },
  }),
  ForbiddenError: class extends Error {},
}))

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

vi.mock('@/server/actions/revalidate-business', () => ({
  revalidateBusinessPublicPaths: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/availability/validation', () => ({
  assertSlotIsAvailable: (...args: unknown[]) => mockAssertSlotIsAvailable(...args),
}))

vi.mock('@/server/services/finance', () => ({
  applyApprovedPayment: (...args: unknown[]) => mockApplyApprovedPayment(...args),
}))

vi.mock('@/lib/notifications', () => ({
  sendBookingReceivedToCustomer: vi.fn(),
  sendNewBookingNotificationToBusiness: vi.fn(),
  sendBookingCancelledNotification: vi.fn(),
  sendBookingConfirmedNotification: vi.fn(),
  sendNotificationSafely: vi.fn().mockResolvedValue({ success: true }),
  sendMultiNotificationSafely: vi.fn().mockResolvedValue([]),
}))

const { createBookingFromDashboard } = await import('@/server/actions/bookings')

const businessId = 'biz-1'
const baseInput = {
  serviceId: 'svc-1',
  customerName: 'Maria Perez',
  customerPhone: '+56 9 1234 5678',
  customerEmail: 'maria@test.com',
  startDateTime: new Date('2026-06-15T14:00:00Z'),
}

function setupTx() {
  mockPrisma.$transaction.mockImplementation(async (fn) => fn({
    customer: mockPrisma.customer,
    booking: mockPrisma.booking,
    payment: mockPrisma.payment,
  }))
}

function setupService(price: number, depositAmount: number) {
  mockPrisma.service.findFirst.mockResolvedValue({
    id: 'svc-1',
    businessId,
    name: 'Manicure',
    price,
    depositAmount,
    durationMinutes: 60,
    isActive: true,
  })
}

function setupCustomer(customer = { id: 'cust-1', businessId, name: 'Maria Perez', phone: '56912345678', email: null }) {
  mockPrisma.customer.findFirst.mockResolvedValue(customer)
  mockPrisma.customer.create.mockResolvedValue(customer)
  mockPrisma.customer.update.mockResolvedValue({ ...customer, email: 'maria@test.com' })
}

function setupBooking() {
  mockPrisma.booking.create.mockResolvedValue({
    id: 'booking-1',
    businessId,
    customerId: 'cust-1',
    service: { name: 'Manicure' },
    customer: { name: 'Maria Perez', phone: '56912345678', email: 'maria@test.com' },
  })
}

describe('createBookingFromDashboard advanced payment modes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupTx()
    setupService(20000, 5000)
    setupCustomer()
    setupBooking()
    mockPrisma.payment.create.mockResolvedValue({ id: 'payment-1' })
    mockApplyApprovedPayment.mockResolvedValue({ booking: { id: 'booking-1' }, wasConfirmed: true })
    mockAssertSlotIsAvailable.mockResolvedValue(undefined)
  })

  it('paymentMode none with deposit creates pending_payment without Payment', async () => {
    await createBookingFromDashboard({ ...baseInput, paymentMode: 'none' })

    const data = mockPrisma.booking.create.mock.calls[0][0].data
    expect(data.status).toBe(BookingStatus.pending_payment)
    expect(data.paymentStatus).toBe(BookingPaymentStatus.unpaid)
    expect(data.holdExpiresAt).toBeInstanceOf(Date)
    expect(mockPrisma.payment.create).not.toHaveBeenCalled()
    expect(mockApplyApprovedPayment).not.toHaveBeenCalled()
  })

  it('paymentMode none with deposit 0 creates confirmed without Payment', async () => {
    setupService(20000, 0)

    await createBookingFromDashboard({ ...baseInput, paymentMode: 'none' })

    const data = mockPrisma.booking.create.mock.calls[0][0].data
    expect(data.status).toBe(BookingStatus.confirmed)
    expect(data.paymentStatus).toBe(BookingPaymentStatus.unpaid)
    expect(data.holdExpiresAt).toBeNull()
    expect(mockPrisma.payment.create).not.toHaveBeenCalled()
  })

  it('paymentMode none with free service creates confirmed fully_paid without Payment', async () => {
    setupService(0, 0)

    await createBookingFromDashboard({ ...baseInput, paymentMode: 'none' })

    const data = mockPrisma.booking.create.mock.calls[0][0].data
    expect(data.status).toBe(BookingStatus.confirmed)
    expect(data.paymentStatus).toBe(BookingPaymentStatus.fully_paid)
    expect(data.remainingBalance).toBe(0)
    expect(mockPrisma.payment.create).not.toHaveBeenCalled()
  })

  it('deposit_paid creates manual deposit Payment and applies ledger via finance service', async () => {
    await createBookingFromDashboard({ ...baseInput, paymentMode: 'deposit_paid', paymentMethod: 'transfer' })

    expect(mockPrisma.payment.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        paymentType: PaymentType.deposit,
        provider: 'manual',
        amount: 5000,
        paymentMethod: 'Transferencia',
      }),
    }))
    expect(mockApplyApprovedPayment).toHaveBeenCalledWith(expect.objectContaining({
      bookingId: 'booking-1',
      businessId,
      amount: 5000,
      paymentType: PaymentType.deposit,
      paymentId: 'payment-1',
    }))
  })

  it('full_paid creates manual full_payment Payment and applies ledger via finance service', async () => {
    await createBookingFromDashboard({ ...baseInput, paymentMode: 'full_paid', paymentMethod: 'cash' })

    expect(mockPrisma.payment.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        paymentType: PaymentType.full_payment,
        provider: 'manual',
        amount: 20000,
        paymentMethod: 'Efectivo',
      }),
    }))
    expect(mockApplyApprovedPayment).toHaveBeenCalledWith(expect.objectContaining({
      amount: 20000,
      paymentType: PaymentType.full_payment,
    }))
  })

  it('rejects deposit_paid when service has no deposit', async () => {
    setupService(20000, 0)

    await expect(createBookingFromDashboard({ ...baseInput, paymentMode: 'deposit_paid', paymentMethod: 'cash' }))
      .rejects.toThrow(/No se requiere abono/)
  })

  it('rejects paid modes without paymentMethod', async () => {
    await expect(createBookingFromDashboard({ ...baseInput, paymentMode: 'deposit_paid' }))
      .rejects.toThrow(/Método de pago requerido/)
  })

  it('fails when slot is occupied', async () => {
    mockAssertSlotIsAvailable.mockRejectedValue(new Error('Ese horario ya no está disponible'))

    await expect(createBookingFromDashboard({ ...baseInput, paymentMode: 'none' }))
      .rejects.toThrow(/horario ya no está disponible/)
  })

  it('validates customerId belongs to business', async () => {
    mockPrisma.customer.findFirst.mockResolvedValue(null)

    await expect(createBookingFromDashboard({ ...baseInput, customerId: 'other-customer', paymentMode: 'none' }))
      .rejects.toThrow(/Cliente no encontrado/)
  })
})

describe('createBookingFromDashboard customer reuse', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupTx()
    setupService(20000, 0)
    setupBooking()
    mockAssertSlotIsAvailable.mockResolvedValue(undefined)
  })

  it('reuses existing customer by normalized phone', async () => {
    setupCustomer({ id: 'cust-existing', businessId, name: 'Maria Antigua', phone: '56912345678', email: null })

    await createBookingFromDashboard({ ...baseInput, customerName: 'Maria Nueva', paymentMode: 'none' })

    expect(mockPrisma.customer.findFirst).toHaveBeenCalledWith({
      where: { phone: '56912345678', businessId },
    })
    expect(mockPrisma.customer.create).not.toHaveBeenCalled()
  })

  it('creates new customer with normalized phone when none exists', async () => {
    mockPrisma.customer.findFirst.mockResolvedValue(null)
    mockPrisma.customer.create.mockResolvedValue({ id: 'cust-new', businessId, name: 'Maria Perez', phone: '56912345678', email: null })

    await createBookingFromDashboard({ ...baseInput, paymentMode: 'none' })

    expect(mockPrisma.customer.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        businessId,
        phone: '56912345678',
      }),
    })
  })
})
