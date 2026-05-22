import { describe, it, expect, vi, beforeEach } from 'vitest'
import { BookingStatus, BookingPaymentStatus } from '@prisma/client'

const mockApplyApprovedPayment = vi.fn()

vi.mock('@/server/services/finance', () => ({
  applyApprovedPayment: mockApplyApprovedPayment,
}))

const mockPrisma = {
  booking: {
    findFirst: vi.fn(),
    findUnique: vi.fn(),
  },
  payment: {
    findFirst: vi.fn(),
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
  requireBusinessRole: vi.fn().mockResolvedValue({ businessId: 'biz-1', business: { currency: 'CLP', timezone: 'America/Santiago' } }),
  ForbiddenError: class extends Error {},
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

vi.mock('@/server/actions/revalidate-business', () => ({
  revalidateBusinessPublicPaths: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/booking-payments', () => ({
  assertBookingPayable: vi.fn(),
}))

const mockSendBookingConfirmedNotification = vi.fn().mockResolvedValue({ success: true })

vi.mock('@/lib/notifications', () => ({
  sendBookingConfirmationToCustomer: vi.fn(),
  sendBookingReceivedToCustomer: vi.fn(),
  sendNewBookingNotificationToBusiness: vi.fn().mockResolvedValue([]),
  sendBookingCancelledNotification: vi.fn(),
  sendBookingConfirmedNotification: mockSendBookingConfirmedNotification,
  sendNotificationSafely: vi.fn(async (_label: string, fn: () => unknown) => {
    try { return await fn() } catch { return { success: false } }
  }),
  sendMultiNotificationSafely: vi.fn().mockResolvedValue([]),
}))

vi.mock('resend', () => ({ Resend: vi.fn() }))
vi.mock('@/lib/availability/validation', () => ({ assertSlotIsAvailable: vi.fn() }))

const { confirmPayment, registerManualPayment } = await import('@/server/actions/bookings')

function fullBooking(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'booking-1',
    businessId: 'biz-1',
    customerId: 'cust-1',
    finalAmount: 20000,
    depositRequired: 10000,
    depositPaid: 0,
    remainingBalance: 20000,
    totalPrice: 20000,
    status: BookingStatus.pending_payment,
    paymentStatus: BookingPaymentStatus.unpaid,
    startDateTime: new Date('2026-06-15T18:00:00Z'),
    endDateTime: new Date('2026-06-15T19:00:00Z'),
    currency: 'CLP',
    holdExpiresAt: null,
    service: { name: 'Manicure' },
    customer: { name: 'Maria', phone: '+56912345678', email: 'maria@test.com' },
    business: {
      name: 'Nails by Ana',
      timezone: 'America/Santiago',
      whatsapp: '+56912345678',
      addressText: 'Av. Siempre Viva 742',
      currency: 'CLP',
      cancellationPolicy: null,
    },
    ...overrides,
  }
}

function pendingPayment() {
  return {
    id: 'booking-1',
    businessId: 'biz-1',
    customerId: 'cust-1',
    finalAmount: 20000,
    depositRequired: 10000,
    depositPaid: 0,
    remainingBalance: 20000,
    status: BookingStatus.pending_payment,
    paymentStatus: BookingPaymentStatus.unpaid,
    currency: 'CLP',
    holdExpiresAt: null,
  }
}

const basePayment = {
  id: 'pay-1',
  bookingId: 'booking-1',
  businessId: 'biz-1',
  amount: 10000,
  currency: 'CLP',
  provider: 'manual',
  providerPaymentId: null,
  paymentType: 'deposit',
  paymentMethod: 'Efectivo',
}

describe('confirmPayment notification behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPrisma.booking.findFirst.mockResolvedValue(pendingPayment())
    mockPrisma.payment.findFirst.mockResolvedValue({ ...basePayment })
  })

  function stubTx(confirmed = false) {
    const updatedBooking = confirmed
      ? { ...pendingPayment(), status: BookingStatus.confirmed }
      : { ...pendingPayment(), depositPaid: 10000, status: BookingStatus.confirmed }
    mockApplyApprovedPayment.mockResolvedValue({ booking: updatedBooking, wasConfirmed: confirmed })
    mockPrisma.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => {
      const tx = { ...mockPrisma }
      return fn(tx)
    })
    mockPrisma.booking.findFirst.mockResolvedValue(
      fullBooking(confirmed ? { status: BookingStatus.confirmed } : { status: BookingStatus.confirmed, depositPaid: 10000, remainingBalance: 10000 }),
    )
  }

  it('sends booking confirmed email when wasConfirmed is true (pending_payment -> confirmed)', async () => {
    stubTx(true)

    await confirmPayment('booking-1', 'pay-1', 10000)

    expect(mockSendBookingConfirmedNotification).toHaveBeenCalledWith('booking-1', 'biz-1')
  })

  it('does NOT send confirmation when booking was already confirmed (wasConfirmed false)', async () => {
    stubTx(false)

    await confirmPayment('booking-1', 'pay-1', 10000)

    expect(mockSendBookingConfirmedNotification).not.toHaveBeenCalled()
  })

  it('does NOT send confirmation when applyApprovedPayment was idempotent (wasConfirmed false)', async () => {
    stubTx(false)

    await confirmPayment('booking-1', 'pay-1', 10000)

    expect(mockSendBookingConfirmedNotification).not.toHaveBeenCalled()
  })
})

describe('registerManualPayment notification behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPrisma.booking.findFirst.mockResolvedValue(pendingPayment())
  })

  function stubTx(confirmed = false) {
    const updatedBooking = confirmed
      ? { ...pendingPayment(), status: BookingStatus.confirmed }
      : { ...pendingPayment(), depositPaid: 10000, remainingBalance: 10000, status: BookingStatus.confirmed }
    mockApplyApprovedPayment.mockResolvedValue({ booking: updatedBooking, wasConfirmed: confirmed })
    mockPrisma.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => {
      const tx = { ...mockPrisma }
      tx.booking = { findUnique: vi.fn().mockResolvedValue(pendingPayment()) }
      return fn(tx)
    })
    mockPrisma.booking.findUnique.mockResolvedValue(
      fullBooking(confirmed ? { status: BookingStatus.confirmed } : { status: BookingStatus.confirmed, depositPaid: 10000 }),
    )
    mockPrisma.booking.findFirst.mockResolvedValue(
      fullBooking(confirmed ? { status: BookingStatus.confirmed } : { status: BookingStatus.confirmed, depositPaid: 10000, remainingBalance: 10000 }),
    )
  }

  it('sends booking confirmed email when wasConfirmed is true', async () => {
    stubTx(true)

    await registerManualPayment('booking-1', 10000, 'Efectivo')

    expect(mockSendBookingConfirmedNotification).toHaveBeenCalledWith('booking-1', 'biz-1')
  })

  it('does NOT send confirmation when booking was already confirmed', async () => {
    stubTx(false)

    await registerManualPayment('booking-1', 5000, 'Efectivo')

    expect(mockSendBookingConfirmedNotification).not.toHaveBeenCalled()
  })
})
