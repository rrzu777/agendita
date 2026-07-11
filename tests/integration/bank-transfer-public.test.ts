import { PrismaClient } from '@prisma/client'
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { requireTestDatabase } from './setup'
import { prisma as sharedPrisma } from '@/lib/db'
import { seedDeclaredTransfer, cleanupBankTransferSeed } from './helpers/bank-transfer-seed'

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

  describe('declareBankTransfer', () => {
    let phoneSeq = 0
    beforeEach(async () => {
      await prisma.bankTransferAccount.deleteMany({ where: { businessId: BIZ } })
      await prisma.bankTransferAccount.create({
        data: {
          businessId: BIZ, accountHolder: 'M', rut: '1-9', bankName: 'BE',
          accountType: 'vista', accountNumber: '1', isEnabled: true,
        },
      })
    })

    async function mkTransferBooking() {
      const { createBooking } = await import('@/server/actions/bookings')
      phoneSeq += 1
      return createBooking({
        serviceId: svc.id, customerName: `Decl ${phoneSeq}`, customerPhone: `+5691130${String(phoneSeq).padStart(4, '0')}`,
        startDateTime: futureDate(10 + phoneSeq, 15), acceptedTerms: true, paymentMethod: 'bank_transfer',
      }, BIZ)
    }

    it('crea el Payment pendiente con monto server-side y mueve el hold a la ventana de verificación', async () => {
      const { declareBankTransfer } = await import('@/server/actions/bank-transfer-public')
      const booking = await mkTransferBooking()

      const before = Date.now()
      const res = await declareBankTransfer(booking.id)
      expect(res.ok).toBe(true)

      const payment = await prisma.payment.findFirst({ where: { bookingId: booking.id } })
      expect(payment!.provider).toBe('manual')
      expect(payment!.status).toBe('pending')
      expect(payment!.paymentType).toBe('deposit')
      expect(payment!.amount).toBe(5000) // min(depositRequired, remainingBalance), NUNCA del cliente
      expect(payment!.providerPaymentId).toBe(`bt-declared:${booking.id}`)
      expect(payment!.paymentMethod).toBe('Transferencia')

      const row = await prisma.booking.findUnique({ where: { id: booking.id } })
      expect(row!.status).toBe('pending_payment')
      expect(row!.paymentStatus).toBe('unpaid') // el cron sigue pudiendo expirarla
      const hours = (row!.holdExpiresAt!.getTime() - before) / 3_600_000
      expect(hours).toBeGreaterThan(47)
      expect(hours).toBeLessThan(49)
    })

    it('es idempotente: doble declare = un solo Payment y ok en ambos', async () => {
      const { declareBankTransfer } = await import('@/server/actions/bank-transfer-public')
      const booking = await mkTransferBooking()
      await declareBankTransfer(booking.id)
      const holdAfterFirst = (await prisma.booking.findUnique({ where: { id: booking.id } }))!.holdExpiresAt
      const res2 = await declareBankTransfer(booking.id)
      expect(res2.ok).toBe(true)
      expect(await prisma.payment.count({ where: { bookingId: booking.id } })).toBe(1)
      // Re-declarar no re-extiende la ventana de verificación:
      const holdAfterSecond = (await prisma.booking.findUnique({ where: { id: booking.id } }))!.holdExpiresAt
      expect(holdAfterSecond).toEqual(holdAfterFirst)
    })

    it('verifyHours null → hold queda NULL (retención indefinida, opt-in)', async () => {
      const { declareBankTransfer } = await import('@/server/actions/bank-transfer-public')
      await prisma.bankTransferAccount.update({ where: { businessId: BIZ }, data: { verifyHours: null } })
      const booking = await mkTransferBooking()
      await declareBankTransfer(booking.id)
      const row = await prisma.booking.findUnique({ where: { id: booking.id } })
      expect(row!.holdExpiresAt).toBeNull()
    })

    it('con hold vencido: error legible y CERO payments (carrera vs cron)', async () => {
      const { declareBankTransfer } = await import('@/server/actions/bank-transfer-public')
      const booking = await mkTransferBooking()
      await prisma.booking.update({ where: { id: booking.id }, data: { holdExpiresAt: new Date(Date.now() - 60_000) } })
      await expect(declareBankTransfer(booking.id)).rejects.toThrow('expiró')
      expect(await prisma.payment.count({ where: { bookingId: booking.id } })).toBe(0)
    })

    it('con booking ya expirada por el cron: error y cero payments', async () => {
      const { declareBankTransfer } = await import('@/server/actions/bank-transfer-public')
      const booking = await mkTransferBooking()
      await prisma.booking.update({ where: { id: booking.id }, data: { status: 'expired' } })
      await expect(declareBankTransfer(booking.id)).rejects.toThrow('expiró')
      expect(await prisma.payment.count({ where: { bookingId: booking.id } })).toBe(0)
    })

    it('rechaza bookings que no eligieron transferencia', async () => {
      const { createBooking } = await import('@/server/actions/bookings')
      const { declareBankTransfer } = await import('@/server/actions/bank-transfer-public')
      const booking = await createBooking({
        serviceId: svc.id, customerName: 'MP', customerPhone: '+56911309999',
        startDateTime: futureDate(9, 15), acceptedTerms: true,
      }, BIZ)
      await expect(declareBankTransfer(booking.id)).rejects.toThrow()
    })
  })

  describe('declareBankTransfer reactivación post-reopen', () => {
    afterAll(async () => {
      await cleanupBankTransferSeed()
    })

    it('bt-declared cancelled → vuelve a pending con monto y createdAt nuevos', async () => {
      const seeded = await seedDeclaredTransfer()
      // Simular ciclo: cron canceló la declaración, dueña reabrió (booking sigue
      // pending_payment con hold vigente en el seed).
      await sharedPrisma.payment.update({
        where: { id: seeded.paymentId },
        data: { status: 'cancelled', createdAt: new Date(Date.now() - 72 * 3_600_000), amount: 1 },
      })
      const before = Date.now()
      const { declareBankTransfer } = await import('@/server/actions/bank-transfer-public')
      await declareBankTransfer(seeded.bookingId)
      const p = await sharedPrisma.payment.findUniqueOrThrow({ where: { id: seeded.paymentId } })
      expect(p.status).toBe('pending')
      expect(p.amount).toBe(10000) // min(depositRequired, remainingBalance) del seed
      expect(p.createdAt.getTime()).toBeGreaterThanOrEqual(before - 5_000)
      // Sigue habiendo UN solo payment bt-declared (unique intacto, sin create nuevo)
      const all = await sharedPrisma.payment.findMany({ where: { bookingId: seeded.bookingId, provider: 'manual' } })
      expect(all).toHaveLength(1)
    })

    it('bt-declared approved → éxito idempotente sin tocar el payment', async () => {
      const seeded = await seedDeclaredTransfer()
      await sharedPrisma.payment.update({ where: { id: seeded.paymentId }, data: { status: 'approved' } })
      const { declareBankTransfer } = await import('@/server/actions/bank-transfer-public')
      await declareBankTransfer(seeded.bookingId)
      const p = await sharedPrisma.payment.findUniqueOrThrow({ where: { id: seeded.paymentId } })
      expect(p.status).toBe('approved')
    })

    it('reactivación con booking expirada → error con mensaje de expirada', async () => {
      const seeded = await seedDeclaredTransfer()
      await sharedPrisma.payment.update({ where: { id: seeded.paymentId }, data: { status: 'cancelled' } })
      await sharedPrisma.booking.update({ where: { id: seeded.bookingId }, data: { status: 'expired' } })
      const { declareBankTransfer } = await import('@/server/actions/bank-transfer-public')
      await expect(declareBankTransfer(seeded.bookingId)).rejects.toThrow('expiró')
      expect((await sharedPrisma.payment.findUniqueOrThrow({ where: { id: seeded.paymentId } })).status).toBe('cancelled')
    })

    it('bt-declared rejected → también reactiva', async () => {
      const seeded = await seedDeclaredTransfer()
      await sharedPrisma.payment.update({ where: { id: seeded.paymentId }, data: { status: 'rejected' } })
      const { declareBankTransfer } = await import('@/server/actions/bank-transfer-public')
      await declareBankTransfer(seeded.bookingId)
      const p = await sharedPrisma.payment.findUniqueOrThrow({ where: { id: seeded.paymentId } })
      expect(p.status).toBe('pending')
    })

    it('booking cancelada / confirmada → mensajes específicos', async () => {
      const cancelled = await seedDeclaredTransfer()
      await sharedPrisma.payment.update({ where: { id: cancelled.paymentId }, data: { status: 'cancelled' } })
      await sharedPrisma.booking.update({ where: { id: cancelled.bookingId }, data: { status: 'cancelled' } })
      const { declareBankTransfer } = await import('@/server/actions/bank-transfer-public')
      await expect(declareBankTransfer(cancelled.bookingId)).rejects.toThrow('Tu reserva fue cancelada.')

      const confirmed = await seedDeclaredTransfer()
      await sharedPrisma.payment.update({ where: { id: confirmed.paymentId }, data: { status: 'cancelled' } })
      await sharedPrisma.booking.update({ where: { id: confirmed.bookingId }, data: { status: 'confirmed' } })
      await expect(declareBankTransfer(confirmed.bookingId)).rejects.toThrow('Tu reserva ya está confirmada.')
    })
  })
})
