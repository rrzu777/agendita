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

describe('confirmBankTransfer', () => {
  it('approves with an edited amount, confirms the booking, cancels no slot', async () => {
    // Declarado 10000, abono requerido 8000: la dueña edita a la baja a 8000
    // (transfirió menos de lo declarado) y AÚN cubre el abono → confirma.
    const { paymentId, bookingId } = await seedDeclaredTransfer({ depositRequired: 8000, amount: 10000 })
    const { confirmBankTransfer } = await import('@/server/actions/bank-transfer-verify')
    await confirmBankTransfer(paymentId, 8000) // editado a la baja desde 10000
    const payment = await prisma.payment.findUnique({ where: { id: paymentId } })
    const booking = await prisma.booking.findUnique({ where: { id: bookingId } })
    expect(payment!.status).toBe('approved')
    expect(payment!.amount).toBe(8000)
    expect(booking!.status).toBe('confirmed')
    expect(booking!.depositPaid).toBe(8000)
  })

  it('rejects when the booking already has an approved payment (double pay)', async () => {
    const { paymentId, bookingId, businessId, customerId } = await seedDeclaredTransfer()
    await prisma.payment.create({
      data: {
        businessId,
        bookingId,
        customerId,
        provider: 'mercado_pago',
        providerPaymentId: `mp-${bookingId}`,
        amount: 10000,
        currency: 'CLP',
        status: 'approved',
        paymentType: 'deposit',
      },
    })
    const { confirmBankTransfer } = await import('@/server/actions/bank-transfer-verify')
    await expect(confirmBankTransfer(paymentId, 5000)).rejects.toThrow(/ya tiene el abono/)
  })

  it('errors on an expired booking (terminal)', async () => {
    const { paymentId, bookingId } = await seedDeclaredTransfer()
    await prisma.booking.update({ where: { id: bookingId }, data: { status: 'expired' } })
    const { confirmBankTransfer } = await import('@/server/actions/bank-transfer-verify')
    await expect(confirmBankTransfer(paymentId, 5000)).rejects.toThrow(/expiró|cancel/)
  })

  it('errors when hold expired and the slot is no longer available', async () => {
    // DESVIACIÓN vs plan: el plan sembraba una reserva confirmada solapada, pero
    // la EXCLUDE constraint parcial `Booking_no_overlap` (activa para
    // pending_payment/confirmed/completed) impide DOS reservas activas solapadas
    // en la BD — no se puede representar. El re-chequeo (assertSlotIsAvailable)
    // igual protege contra que el horario deje de estar disponible por otra vía
    // (bloqueo/regla) una vez vencido el hold; lo ejercemos con un TimeBlock.
    // Sin el re-chequeo, el bump del hold dejaría pasar la confirmación → este
    // test discrimina que el re-chequeo efectivamente corre.
    const { paymentId, bookingId, businessId, startDateTime, endDateTime } =
      await seedDeclaredTransfer()
    await prisma.booking.update({
      where: { id: bookingId },
      data: { holdExpiresAt: new Date(Date.now() - 3600_000) },
    })
    // Reglas de disponibilidad amplias (todos los días) para pasar el chequeo de
    // regla y que el rechazo lo cause el bloqueo, no la falta de regla.
    for (let dow = 0; dow < 7; dow++) {
      await prisma.availabilityRule.create({
        data: { businessId, dayOfWeek: dow, startTime: '00:00', endTime: '23:59', isActive: true },
      })
    }
    // Bloqueo horario que ocupa el slot (el horario "ya no está disponible").
    await prisma.timeBlock.create({
      data: { businessId, startDateTime, endDateTime, reason: 'ocupado' },
    })
    const { confirmBankTransfer } = await import('@/server/actions/bank-transfer-verify')
    await expect(confirmBankTransfer(paymentId, 5000)).rejects.toThrow(/horario|disponible/)
  })
})
