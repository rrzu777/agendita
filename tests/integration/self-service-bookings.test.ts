import { PrismaClient } from '@prisma/client'
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { requireTestDatabase } from './setup'
import { declaredTransferPaymentWhere, btDeclaredId } from '@/lib/bank-transfer/declared'
import { expectActionError } from './helpers/action-result'

requireTestDatabase()

// Approach: cancelMyBooking/rescheduleMyBooking (server actions 'use server') envuelven
// su lógica con requireUser (sesión), checkRateLimit, revalidatePath/revalidateBusinessPublicPaths
// y notificaciones. Siguiendo el precedente de customer-account-link.test.ts y
// bank-transfer-verify.test.ts, mockeamos esas capas de infraestructura para ejercitar la
// LÓGICA REAL de cancelación/reprogramación (ownership vía where, ventana de cutoff,
// anti-doble-booking) contra un Postgres real.
const BIZ = 'ss-biz-1'
const OWNER_USER = 'ss-owner-1'
const USER = 'ss-user-1'
const OTHER_USER = 'ss-other-user-1'

let mockSessionUser: { id: string; email: string; email_confirmed_at: string | null } | null = null

vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: async () => ({ success: true, remaining: 30, resetAt: 0 }) }))
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
vi.mock('@/server/actions/revalidate-business', () => ({ revalidateBusinessPublicPaths: async () => {} }))
vi.mock('@/lib/notifications', () => ({
  getBusinessReplyToEmail: async () => 'owner@ss.test',
  sendBookingCancelledNotification: async () => ({ success: true }),
  sendBookingRescheduledNotification: async () => ({ success: true }),
  sendOwnerBookingChangedNotification: async () => ({ success: true }),
  sendNotificationSafely: async () => ({ success: true }),
  sendMultiNotificationSafely: async () => [],
}))
vi.mock('@/lib/auth/user', () => ({
  getCurrentUser: async () => mockSessionUser,
  getConfirmedSessionUser: async () => mockSessionUser,
}))

describe('self-service bookings (cancelMyBooking / rescheduleMyBooking)', () => {
  let prisma: PrismaClient
  let svc: { id: string; durationMinutes: number }

  function hoursFromNow(h: number): Date {
    return new Date(Date.now() + h * 3_600_000)
  }

  async function setCutoff(hours: number) {
    await prisma.business.update({ where: { id: BIZ }, data: { selfServiceCutoffHours: hours } })
  }

  async function createCustomer(idSuffix: string, userId: string | null) {
    return prisma.customer.create({
      data: {
        businessId: BIZ,
        name: `Cliente ${idSuffix}`,
        phone: `+5691200${idSuffix}`,
        email: `cliente-${idSuffix}@ss.test`,
        userId,
      },
    })
  }

  async function createBooking(opts: {
    customerId: string
    startDateTime: Date
    status?: 'pending_payment' | 'confirmed' | 'completed'
    durationMinutes?: number
  }) {
    const duration = opts.durationMinutes ?? svc.durationMinutes
    return prisma.booking.create({
      data: {
        businessId: BIZ,
        serviceId: svc.id,
        customerId: opts.customerId,
        startDateTime: opts.startDateTime,
        endDateTime: new Date(opts.startDateTime.getTime() + duration * 60_000),
        status: opts.status ?? 'confirmed',
        totalPrice: 20000,
        depositRequired: 0,
        depositPaid: 0,
        remainingBalance: 20000,
        discountAmount: 0,
        finalAmount: 20000,
        paymentStatus: 'unpaid',
      },
    })
  }

  beforeAll(async () => {
    prisma = new PrismaClient()

    await prisma.payment.deleteMany({})
    await prisma.booking.deleteMany({})
    await prisma.customer.deleteMany({})
    await prisma.service.deleteMany({})
    await prisma.availabilityRule.deleteMany({})
    await prisma.businessUser.deleteMany({})
    await prisma.business.deleteMany({})
    await prisma.user.deleteMany({ where: { id: { in: [OWNER_USER, USER, OTHER_USER] } } })

    await prisma.user.create({ data: { id: OWNER_USER, email: 'owner@ss.test', name: 'SS Owner' } })
    await prisma.user.create({ data: { id: USER, email: 'user@ss.test', name: 'SS User' } })
    await prisma.user.create({ data: { id: OTHER_USER, email: 'other@ss.test', name: 'SS Other' } })

    await prisma.business.create({
      data: {
        id: BIZ,
        name: 'SS Biz',
        slug: 'ss-biz',
        subdomain: 'ssbiz',
        ownerUserId: OWNER_USER,
        city: 'Santiago',
        country: 'CL',
        currency: 'CLP',
        timezone: 'America/Santiago',
        bookingWindowDays: 90,
        selfServiceCutoffHours: 24,
      },
    })

    await prisma.businessUser.create({
      data: { id: 'ss-bu-owner', businessId: BIZ, userId: OWNER_USER, role: 'owner' },
    })

    svc = await prisma.service.create({
      data: {
        id: 'ss-svc-1',
        businessId: BIZ,
        name: 'Corte',
        durationMinutes: 60,
        price: 20000,
        depositAmount: 0,
        pastelColor: '#FFD700',
      },
    })

    // Toda la semana disponible 00:00-23:59 para no depender de qué día caiga "ahora + N horas".
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
    await prisma.service.deleteMany({ where: { businessId: BIZ } })
    await prisma.availabilityRule.deleteMany({ where: { businessId: BIZ } })
    await prisma.businessUser.deleteMany({ where: { businessId: BIZ } })
    await prisma.business.deleteMany({ where: { id: BIZ } })
    await prisma.user.deleteMany({ where: { id: { in: [OWNER_USER, USER, OTHER_USER] } } })
    await prisma.$disconnect()
  })

  beforeEach(async () => {
    mockSessionUser = { id: USER, email: 'user@ss.test', email_confirmed_at: '2026-01-01T00:00:00Z' }
    await setCutoff(24)
    // La DB tiene la constraint de exclusión Booking_no_overlap (businessId + tsrange):
    // las reservas activas que deja un caso chocan con las del siguiente (todas usan
    // hoursFromNow(48)). Cada caso siembra lo suyo → limpiar entre casos.
    await prisma.payment.deleteMany({ where: { businessId: BIZ } })
    await prisma.booking.deleteMany({ where: { businessId: BIZ } })
  })

  describe('cancelMyBooking', () => {
    it('cancels a confirmed booking within window owned by the caller, and closes a pending bt-declared Payment', async () => {
      const { cancelMyBooking } = await import('@/server/actions/my-bookings')

      const customer = await createCustomer('cancel-happy', USER)
      const booking = await createBooking({ customerId: customer.id, startDateTime: hoursFromNow(48), status: 'confirmed' })
      const payment = await prisma.payment.create({
        data: {
          businessId: BIZ,
          bookingId: booking.id,
          customerId: customer.id,
          provider: 'manual',
          providerPaymentId: btDeclaredId(booking.id),
          amount: 10000,
          currency: 'CLP',
          status: 'pending',
          paymentType: 'deposit',
          paymentMethod: 'Transferencia',
        },
      })

      const result = await cancelMyBooking(booking.id)
      expect(result).toEqual({ ok: true, data: { cancelled: true } })

      const after = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })
      expect(after.status).toBe('cancelled')

      const paymentAfter = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })
      expect(paymentAfter.status).toBe('cancelled')

      // Sanity: la fila que quedó abierta corresponde al where reusable de declared transfers.
      const stillDeclared = await prisma.payment.findFirst({
        where: { bookingId: booking.id, ...declaredTransferPaymentWhere },
      })
      expect(stillDeclared).toBeNull()
    })

    it('throws "Reserva no encontrada" when the booking belongs to another user\'s customer', async () => {
      const { cancelMyBooking } = await import('@/server/actions/my-bookings')

      const otherCustomer = await createCustomer('cancel-ajeno', OTHER_USER)
      const booking = await createBooking({ customerId: otherCustomer.id, startDateTime: hoursFromNow(48), status: 'confirmed' })

      await expectActionError(cancelMyBooking(booking.id), 'Reserva no encontrada')

      const after = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })
      expect(after.status).toBe('confirmed')
    })

    it('throws when the booking is inside the cutoff window', async () => {
      const { cancelMyBooking } = await import('@/server/actions/my-bookings')

      const customer = await createCustomer('cancel-cutoff', USER)
      const booking = await createBooking({ customerId: customer.id, startDateTime: hoursFromNow(2), status: 'confirmed' })

      await expectActionError(cancelMyBooking(booking.id), 'hasta 24 horas')

      const after = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })
      expect(after.status).toBe('confirmed')
    })

    it('throws "Reserva no encontrada" for a completed booking (filtered out by the where)', async () => {
      const { cancelMyBooking } = await import('@/server/actions/my-bookings')

      const customer = await createCustomer('cancel-completed', USER)
      const booking = await createBooking({ customerId: customer.id, startDateTime: hoursFromNow(48), status: 'completed' })

      await expectActionError(cancelMyBooking(booking.id), 'Reserva no encontrada')

      const after = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })
      expect(after.status).toBe('completed')
    })

    it('cancels with cutoff 0 (sin límite) even close to the appointment', async () => {
      const { cancelMyBooking } = await import('@/server/actions/my-bookings')
      await setCutoff(0)

      const customer = await createCustomer('cancel-nolimit', USER)
      const booking = await createBooking({ customerId: customer.id, startDateTime: hoursFromNow(1), status: 'confirmed' })

      const result = await cancelMyBooking(booking.id)
      expect(result).toEqual({ ok: true, data: { cancelled: true } })

      const after = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })
      expect(after.status).toBe('cancelled')
    })
  })

  describe('rescheduleMyBooking', () => {
    it('reschedules a confirmed booking within window to a new slot, recording the history note', async () => {
      const { rescheduleMyBooking } = await import('@/server/actions/my-bookings')

      const customer = await createCustomer('resch-happy', USER)
      const originalStart = hoursFromNow(48)
      const booking = await createBooking({ customerId: customer.id, startDateTime: originalStart, status: 'confirmed' })

      const newStart = hoursFromNow(72)
      const result = await rescheduleMyBooking(booking.id, newStart)
      expect(result).toEqual({ ok: true, data: { rescheduled: true } })

      const after = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })
      expect(after.startDateTime.getTime()).toBe(newStart.getTime())
      expect(after.endDateTime.getTime()).toBe(newStart.getTime() + svc.durationMinutes * 60_000)
      expect(after.internalNotes ?? '').toContain('[REPROGRAMADA de')
    })

    it('throws when the target slot is already double-booked, leaving the original untouched', async () => {
      const { rescheduleMyBooking } = await import('@/server/actions/my-bookings')

      const customer = await createCustomer('resch-double-a', USER)
      const originalStart = hoursFromNow(48)
      const booking = await createBooking({ customerId: customer.id, startDateTime: originalStart, status: 'confirmed' })

      const targetStart = hoursFromNow(96)
      const otherCustomer = await createCustomer('resch-double-b', OTHER_USER)
      await createBooking({ customerId: otherCustomer.id, startDateTime: targetStart, status: 'confirmed' })

      await expectActionError(rescheduleMyBooking(booking.id, targetStart), 'ya no está disponible')

      const after = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })
      expect(after.startDateTime.getTime()).toBe(originalStart.getTime())
    })
  })
})
