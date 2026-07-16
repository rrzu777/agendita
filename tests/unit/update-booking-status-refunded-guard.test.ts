import { describe, it, expect, vi, beforeEach } from 'vitest'
import { BookingStatus } from '@prisma/client'

const mockPrisma = {
  booking: {
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    updateMany: vi.fn(),
    count: vi.fn(),
  },
  customer: {
    update: vi.fn(),
  },
  payment: {
    updateMany: vi.fn().mockResolvedValue({ count: 0 }),
  },
  loyaltyConfig: {
    findUnique: vi.fn(),
  },
  $transaction: vi.fn(),
}

vi.mock('@/lib/db', () => ({ prisma: mockPrisma }))
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: vi.fn().mockResolvedValue({ success: true }) }))
vi.mock('@/lib/auth/server', () => ({
  requireBusiness: vi.fn().mockResolvedValue({ businessId: 'biz-1' }),
  requireBusinessRole: vi.fn().mockResolvedValue({ businessId: 'biz-1' }),
  ForbiddenError: class extends Error {},
}))
vi.mock('@/lib/auth/user', () => ({ getCurrentUser: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/server/actions/revalidate-business', () => ({
  revalidateBusinessPublicPaths: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/promotions/release', () => ({ releaseRedemptionForBooking: vi.fn() }))
vi.mock('@/lib/loyalty/credit', () => ({ creditVisitPoints: vi.fn() }))
vi.mock('@/lib/loyalty/automatic', () => ({
  emitAutomaticReward: vi.fn(),
  loadAutomaticRules: vi.fn().mockResolvedValue([]),
}))
vi.mock('@/lib/loyalty/referral', () => ({
  rewardReferralOnCompletion: vi.fn(),
  captureReferral: vi.fn(),
  notifyReferralReward: vi.fn(),
}))
vi.mock('@/lib/notifications', () => ({
  sendBookingReceivedToCustomer: vi.fn(),
  sendNewBookingNotificationToBusiness: vi.fn(),
  sendBookingCancelledNotification: vi.fn(),
  sendBookingConfirmedNotification: vi.fn(),
  sendBookingRescheduledNotification: vi.fn(),
  sendNotificationSafely: (_l: string, fn: () => unknown) => fn(),
  sendMultiNotificationSafely: (_l: string, fn: () => unknown) => fn(),
  getBusinessReplyToEmail: vi.fn().mockResolvedValue(null),
}))

const { updateBookingStatus } = await import('@/server/actions/bookings')
const { creditVisitPoints } = await import('@/lib/loyalty/credit')
const { loadAutomaticRules } = await import('@/lib/loyalty/automatic')

function makeBooking(paymentStatus: string) {
  return {
    id: 'bk-1',
    businessId: 'biz-1',
    customerId: 'cust-1',
    status: BookingStatus.confirmed,
    paymentStatus,
    finalAmount: 20000,
    reviewToken: null,
    startDateTime: new Date('2026-07-20T15:00:00Z'),
    customer: { name: 'Caro', email: null },
    service: { name: 'Manicure' },
    business: { name: 'Estudio', timezone: 'America/Santiago' },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockPrisma.booking.updateMany.mockResolvedValue({ count: 1 })
  mockPrisma.booking.count.mockResolvedValue(1) // no es primera visita
  mockPrisma.customer.update.mockResolvedValue({})
  mockPrisma.payment.updateMany.mockResolvedValue({ count: 0 })
  mockPrisma.loyaltyConfig.findUnique.mockResolvedValue({
    isActive: true, pointsPerVisit: 10, spendPerPoint: null, minSpendToEarn: null,
    grantExpiryDays: null, forfeitGrantOnNoShow: false,
  })
  mockPrisma.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(mockPrisma))
})

describe('updateBookingStatus — completar con pago revertido (spec FU-B4b-3 §7)', () => {
  it('paymentStatus refunded: la transición ocurre pero NO acredita puntos ni emite auto-rewards', async () => {
    const booking = makeBooking('refunded')
    mockPrisma.booking.findFirst.mockResolvedValue(booking)
    mockPrisma.booking.findUnique.mockResolvedValue({ ...booking, status: BookingStatus.completed })

    await updateBookingStatus('bk-1', BookingStatus.completed)

    expect(mockPrisma.booking.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: BookingStatus.completed }),
    }))
    expect(creditVisitPoints).not.toHaveBeenCalled()
    expect(loadAutomaticRules).not.toHaveBeenCalled()
    // La marca first/lastCompletedAt NO es loyalty y se mantiene.
    expect(mockPrisma.customer.update).toHaveBeenCalled()
  })

  it('paymentStatus deposit_paid (control): SÍ acredita puntos', async () => {
    const booking = makeBooking('deposit_paid')
    mockPrisma.booking.findFirst.mockResolvedValue(booking)
    mockPrisma.booking.findUnique.mockResolvedValue({ ...booking, status: BookingStatus.completed })

    await updateBookingStatus('bk-1', BookingStatus.completed)

    expect(creditVisitPoints).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      bookingId: 'bk-1', customerId: 'cust-1',
    }))
    expect(loadAutomaticRules).toHaveBeenCalled()
  })
})
