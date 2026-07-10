import { PrismaClient } from '@prisma/client'
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { requireTestDatabase } from './setup'

requireTestDatabase()

// Mismo approach que customer-account-link.test.ts: mockeamos las capas de
// infraestructura (rate limit, revalidación, notificaciones, sesión) para
// ejercitar la LÓGICA REAL de createBooking/declareBankTransfer contra un
// Postgres real.
const BIZ = 'btp-biz-1'
const OWNER_USER = 'btp-owner-1'

vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: async () => ({ success: true, remaining: 30, resetAt: 0 }) }))
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
vi.mock('@/server/actions/revalidate-business', () => ({ revalidateBusinessPublicPaths: async () => {} }))
vi.mock('@/lib/notifications', () => ({
  getBusinessReplyToEmail: async () => 'owner@btp.test',
  sendBookingReceivedToCustomer: async () => ({ success: true }),
  sendNewBookingNotificationToBusiness: async () => [],
  sendBookingCancelledNotification: async () => ({ success: true }),
  sendBookingConfirmedNotification: async () => ({ success: true }),
  sendBookingRescheduledNotification: async () => ({ success: true }),
  sendBankTransferDeclaredToBusiness: async () => [],
  sendNotificationSafely: async () => ({ success: true }),
  sendMultiNotificationSafely: async () => [],
}))
vi.mock('@/lib/auth/user', () => ({
  getCurrentUser: async () => null,
}))

describe('bank-transfer flujo público', () => {
  let prisma: PrismaClient
  let svc: { id: string }

  beforeAll(async () => {
    prisma = new PrismaClient()

    await prisma.payment.deleteMany({ where: { businessId: BIZ } })
    await prisma.booking.deleteMany({ where: { businessId: BIZ } })
    await prisma.customer.deleteMany({ where: { businessId: BIZ } })
    await prisma.bankTransferAccount.deleteMany({ where: { businessId: BIZ } })
    await prisma.service.deleteMany({ where: { businessId: BIZ } })
    await prisma.availabilityRule.deleteMany({ where: { businessId: BIZ } })
    await prisma.businessUser.deleteMany({ where: { businessId: BIZ } })
    await prisma.business.deleteMany({ where: { id: BIZ } })
    await prisma.user.deleteMany({ where: { id: OWNER_USER } })

    await prisma.user.create({ data: { id: OWNER_USER, email: 'owner@btp.test', name: 'BTP Owner' } })
    await prisma.business.create({
      data: {
        id: BIZ, name: 'BTP Biz', slug: 'btp-biz', subdomain: 'btpbiz', ownerUserId: OWNER_USER,
        city: 'Santiago', country: 'CL', currency: 'CLP', timezone: 'America/Santiago', bookingWindowDays: 90,
      },
    })
    await prisma.businessUser.create({ data: { id: 'btp-bu-1', businessId: BIZ, userId: OWNER_USER, role: 'owner' } })

    svc = await prisma.service.create({
      data: {
        id: 'btp-svc-1', businessId: BIZ, name: 'Corte', durationMinutes: 60,
        price: 20000, depositAmount: 5000, pastelColor: '#FFD700',
      },
    })

    for (let day = 0; day <= 6; day++) {
      await prisma.availabilityRule.create({
        data: { businessId: BIZ, dayOfWeek: day, startTime: '00:00', endTime: '23:59', isActive: true },
      })
    }
  })

  afterAll(async () => {
    await prisma.payment.deleteMany({ where: { businessId: BIZ } })
    await prisma.booking.deleteMany({ where: { businessId: BIZ } })
    await prisma.customer.deleteMany({ where: { businessId: BIZ } })
    await prisma.bankTransferAccount.deleteMany({ where: { businessId: BIZ } })
    await prisma.service.deleteMany({ where: { businessId: BIZ } })
    await prisma.availabilityRule.deleteMany({ where: { businessId: BIZ } })
    await prisma.businessUser.deleteMany({ where: { businessId: BIZ } })
    await prisma.business.deleteMany({ where: { id: BIZ } })
    await prisma.user.deleteMany({ where: { id: OWNER_USER } })
    await prisma.$disconnect()
  })

  function futureDate(daysAhead: number, hourUTC: number) {
    const d = new Date()
    d.setUTCDate(d.getUTCDate() + daysAhead)
    d.setUTCHours(hourUTC, 0, 0, 0)
    return d
  }

  describe('getBankTransferInfo', () => {
    beforeEach(async () => {
      await prisma.bankTransferAccount.deleteMany({ where: { businessId: BIZ } })
    })

    it('devuelve null sin cuenta, null deshabilitada, e info pública habilitada', async () => {
      const { getBankTransferInfo } = await import('@/server/actions/bank-transfer-public')

      expect(await getBankTransferInfo(BIZ)).toBeNull()

      await prisma.bankTransferAccount.create({
        data: {
          businessId: BIZ, accountHolder: 'María', rut: '1-9', bankName: 'BancoEstado',
          accountType: 'vista', accountNumber: '123', isEnabled: false,
        },
      })
      expect(await getBankTransferInfo(BIZ)).toBeNull()

      await prisma.bankTransferAccount.update({ where: { businessId: BIZ }, data: { isEnabled: true } })
      const info = await getBankTransferInfo(BIZ)
      expect(info).not.toBeNull()
      expect(info!.bankName).toBe('BancoEstado')
      expect(info!.holdHours).toBe(24)
      // No filtra campos server-side:
      expect(info).not.toHaveProperty('isEnabled')
      expect(info).not.toHaveProperty('verifyHours')
    })
  })

  describe('createBooking con transferencia', () => {
    beforeEach(async () => {
      await prisma.bankTransferAccount.deleteMany({ where: { businessId: BIZ } })
      await prisma.bankTransferAccount.create({
        data: {
          businessId: BIZ, accountHolder: 'M', rut: '1-9', bankName: 'BE',
          accountType: 'vista', accountNumber: '1', isEnabled: true,
        },
      })
    })

    it('setea hold largo y persiste paymentMethod', async () => {
      const { createBooking } = await import('@/server/actions/bookings')

      const before = Date.now()
      const booking = await createBooking({
        serviceId: svc.id, customerName: 'Ana', customerPhone: '+56911200001',
        startDateTime: futureDate(2, 15), acceptedTerms: true, paymentMethod: 'bank_transfer',
      }, BIZ)

      const row = await prisma.booking.findUnique({ where: { id: booking.id } })
      expect(row!.paymentMethod).toBe('bank_transfer')
      expect(row!.status).toBe('pending_payment')
      const hours = (row!.holdExpiresAt!.getTime() - before) / 3_600_000
      expect(hours).toBeGreaterThan(23)
      expect(hours).toBeLessThan(25)
    })

    it('rechaza bank_transfer si el negocio no lo tiene habilitado', async () => {
      const { createBooking } = await import('@/server/actions/bookings')
      await prisma.bankTransferAccount.update({ where: { businessId: BIZ }, data: { isEnabled: false } })
      await expect(createBooking({
        serviceId: svc.id, customerName: 'Bea', customerPhone: '+56911200002',
        startDateTime: futureDate(3, 15), acceptedTerms: true, paymentMethod: 'bank_transfer',
      }, BIZ)).rejects.toThrow('transferencia')
    })

    it('sin paymentMethod el hold sigue siendo ~15min', async () => {
      const { createBooking } = await import('@/server/actions/bookings')
      const before = Date.now()
      const booking = await createBooking({
        serviceId: svc.id, customerName: 'Cata', customerPhone: '+56911200003',
        startDateTime: futureDate(4, 15), acceptedTerms: true,
      }, BIZ)
      const row = await prisma.booking.findUnique({ where: { id: booking.id } })
      expect(row!.paymentMethod).toBeNull()
      const mins = (row!.holdExpiresAt!.getTime() - before) / 60_000
      expect(mins).toBeGreaterThan(13)
      expect(mins).toBeLessThan(17)
    })
  })
})
