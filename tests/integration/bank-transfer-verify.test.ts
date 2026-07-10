import { describe, it, expect, afterAll, vi } from 'vitest'
import { prisma } from '@/lib/db'
import { btDeclaredId } from '@/lib/bank-transfer/declared'
import { requireTestDatabase } from './setup'
import { seedDeclaredTransfer, cleanupBankTransferSeed } from './helpers/bank-transfer-seed'

requireTestDatabase()

// Mismo approach que packages-actions.test.ts / bank-transfer-public.test.ts:
// mockeamos las capas de infraestructura (auth, rate limit, revalidación,
// notificaciones) para ejercitar la LÓGICA REAL de las actions contra un
// Postgres real. El mock de auth resuelve al negocio sembrado por el helper
// vía su slug (literal, sin binding → seguro con el hoisting de vi.mock).
vi.mock('@/lib/auth/server', () => ({
  requireBusiness: async () => {
    const { prisma } = await import('@/lib/db')
    const business = await prisma.business.findFirstOrThrow({ where: { slug: 'btv-biz' } })
    return { user: { id: business.ownerUserId }, business, role: 'owner', businessId: business.id }
  },
  requireBusinessRole: async () => {
    const { prisma } = await import('@/lib/db')
    const business = await prisma.business.findFirstOrThrow({ where: { slug: 'btv-biz' } })
    return { user: { id: business.ownerUserId }, business, role: 'owner', businessId: business.id }
  },
  ForbiddenError: class extends Error {},
}))
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: async () => ({ success: true, remaining: 30, resetAt: 0 }) }))
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
vi.mock('@/server/actions/revalidate-business', () => ({ revalidateBusinessPublicPaths: async () => {} }))
vi.mock('@/lib/auth/user', () => ({ getCurrentUser: async () => null }))
vi.mock('@/lib/notifications', () => ({
  getBusinessReplyToEmail: async () => 'owner@btv.test',
  sendBookingReceivedToCustomer: async () => ({ success: true }),
  sendNewBookingNotificationToBusiness: async () => [],
  sendBookingCancelledNotification: async () => ({ success: true }),
  sendBookingConfirmedNotification: async () => ({ success: true }),
  sendBookingRescheduledNotification: async () => ({ success: true }),
  sendBankTransferRejectedToCustomer: async () => ({ success: true }),
  sendBankTransferExpiredToCustomer: async () => ({ success: true }),
  sendNotificationSafely: async () => ({ success: true }),
  sendMultiNotificationSafely: async () => [],
  buildWhatsappUrl: () => 'https://wa.me/x',
}))

afterAll(async () => {
  await cleanupBankTransferSeed()
  await prisma.$disconnect()
})

describe('getBookings includes declared transfer payment', () => {
  it('returns the pending bt-declared payment on the booking, empty for others', async () => {
    const { businessId, bookingId } = await seedDeclaredTransfer()
    // Otra reserva sin transferencia declarada → payments vacío.
    const { seedConfirmedBooking } = await import('./helpers/bank-transfer-seed')
    const other = await seedConfirmedBooking({
      businessId,
      serviceId: 'btv-svc-1',
      startDateTime: new Date('2027-01-10T12:00:00Z'),
      endDateTime: new Date('2027-01-10T13:00:00Z'),
    })

    const { getBookings } = await import('@/server/actions/bookings')
    const bookings = await getBookings()

    const target = bookings.find((b) => b.id === bookingId)!
    expect(target.payments).toHaveLength(1)
    expect(target.payments[0].providerPaymentId).toBe(btDeclaredId(bookingId))
    expect(target.payments[0].amount).toBeGreaterThan(0)
    expect(target.payments[0].createdAt).toBeInstanceOf(Date)

    const otherRow = bookings.find((b) => b.id === other.bookingId)!
    expect(otherRow.payments).toHaveLength(0)
  })
})
