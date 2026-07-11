import { describe, it, expect, afterAll, vi } from 'vitest'
import { addMinutes } from 'date-fns'
import { prisma } from '@/lib/db'
import { requireTestDatabase } from './setup'
import {
  seedDeclaredTransfer,
  cleanupBankTransferSeed,
  BT_VERIFY_BIZ,
} from './helpers/bank-transfer-seed'

requireTestDatabase()

// Mismo approach que bank-transfer-verify.test.ts: mockeamos las capas de
// infraestructura (auth, rate limit, revalidación, notificaciones) para
// ejercitar la LÓGICA REAL de la action contra un Postgres real. El mock de
// auth resuelve al negocio sembrado por el helper vía su slug (literal, sin
// binding → seguro con el hoisting de vi.mock).
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
  sendTransferReactivatedToCustomer: async () => ({ success: true }),
  // Ejecuta el callback para que la construcción del payload post-tx corra en
  // los tests (los senders internos ya están mockeados).
  sendNotificationSafely: async (_label: string, fn: () => Promise<unknown>) => {
    await fn()
    return { success: true }
  },
  sendMultiNotificationSafely: async () => [],
  buildWhatsappUrl: () => 'https://wa.me/x',
}))

import { reviveBooking } from '@/server/actions/revive-booking'

afterAll(async () => {
  await prisma.timeBlock.deleteMany({ where: { businessId: BT_VERIFY_BIZ } })
  await cleanupBankTransferSeed()
  await prisma.$disconnect()
})

// Helper local: sembrar una declarada y expirarla como lo haría el cron.
async function seedExpired(opts: Parameters<typeof seedDeclaredTransfer>[0] = {}) {
  const seeded = await seedDeclaredTransfer(opts)
  await prisma.booking.update({ where: { id: seeded.bookingId }, data: { status: 'expired' } })
  if (seeded.paymentId) {
    await prisma.payment.update({ where: { id: seeded.paymentId }, data: { status: 'cancelled' } })
  }
  return seeded
}

describe('reviveBooking confirm', () => {
  it('expired futura → confirmed, holdExpiresAt null', async () => {
    const seeded = await seedExpired()
    await reviveBooking(seeded.bookingId, 'confirm')
    const b = await prisma.booking.findUniqueOrThrow({ where: { id: seeded.bookingId } })
    expect(b.status).toBe('confirmed')
    expect(b.holdExpiresAt).toBeNull()
  })

  it('turno pasado también se puede confirmar (sin chequeo de cupo)', async () => {
    const start = new Date(Date.now() - 48 * 3_600_000)
    const seeded = await seedExpired({
      startDateTime: start,
      endDateTime: addMinutes(start, 60),
      holdExpiresAt: new Date(Date.now() - 72 * 3_600_000),
    })
    await reviveBooking(seeded.bookingId, 'confirm')
    const b = await prisma.booking.findUniqueOrThrow({ where: { id: seeded.bookingId } })
    expect(b.status).toBe('confirmed')
  })

  it('no-expired → error; doble revive → error de estado', async () => {
    const seeded = await seedDeclaredTransfer() // pending_payment, no expirada
    await expect(reviveBooking(seeded.bookingId, 'confirm')).rejects.toThrow('Solo se puede revivir')
    const expired = await seedExpired()
    await reviveBooking(expired.bookingId, 'confirm')
    await expect(reviveBooking(expired.bookingId, 'confirm')).rejects.toThrow('Solo se puede revivir')
  })

  it('conflicto de cupo (TimeBlock) en turno futuro → error traducido', async () => {
    const seeded = await seedExpired()
    const b = await prisma.booking.findUniqueOrThrow({ where: { id: seeded.bookingId } })
    const block = await prisma.timeBlock.create({
      data: {
        businessId: BT_VERIFY_BIZ,
        startDateTime: b.startDateTime,
        endDateTime: b.endDateTime,
        reason: 'ocupa el slot',
      },
    })
    await expect(reviveBooking(seeded.bookingId, 'confirm')).rejects.toThrow('ya no está disponible')
    const still = await prisma.booking.findUniqueOrThrow({ where: { id: seeded.bookingId } })
    expect(still.status).toBe('expired')
    await prisma.timeBlock.delete({ where: { id: block.id } })
  })

  it('constraint Booking_no_overlap (turno pasado + completed solapada) → error legible, sigue expired', async () => {
    const start = new Date(Date.now() - 24 * 3_600_000)
    const slotOpts = {
      startDateTime: start,
      endDateTime: addMinutes(start, 60),
      holdExpiresAt: new Date(Date.now() - 30 * 3_600_000),
    }
    const seeded = await seedExpired(slotOpts)
    // Reserva completed en el MISMO horario: el EXCLUDE la cuenta, el confirm de
    // turno pasado no chequea.
    const { seedConfirmedBooking } = await import('./helpers/bank-transfer-seed')
    const other = await seedConfirmedBooking({ businessId: BT_VERIFY_BIZ, serviceId: 'btv-svc-1', ...slotOpts })
    await prisma.booking.update({ where: { id: other.bookingId }, data: { status: 'completed' } })
    await expect(reviveBooking(seeded.bookingId, 'confirm')).rejects.toThrow('Ese horario ya está ocupado')
    const still = await prisma.booking.findUniqueOrThrow({ where: { id: seeded.bookingId } })
    expect(still.status).toBe('expired')
  })
})

describe('reviveBooking reopen', () => {
  it('expired transferencia futura → pending_payment, hold=holdHours, flags reset, MP pendings cancelados', async () => {
    const seeded = await seedExpired()
    // flags "ya mandados" + un MP pending viejo que debe morir en la tx
    await prisma.booking.update({
      where: { id: seeded.bookingId },
      data: { transferReminderCustomerSentAt: new Date(), transferReminderBusinessSentAt: new Date() },
    })
    const mp = await prisma.payment.create({
      data: {
        businessId: BT_VERIFY_BIZ, bookingId: seeded.bookingId, customerId: seeded.customerId,
        provider: 'mercado_pago', providerPaymentId: `mp-stale-${seeded.bookingId}`,
        amount: 10000, currency: 'CLP', status: 'pending', paymentType: 'deposit',
      },
    })
    const before = Date.now()
    await reviveBooking(seeded.bookingId, 'reopen')
    const b = await prisma.booking.findUniqueOrThrow({ where: { id: seeded.bookingId } })
    expect(b.status).toBe('pending_payment')
    expect(b.transferReminderCustomerSentAt).toBeNull()
    expect(b.transferReminderBusinessSentAt).toBeNull()
    // holdHours de la cuenta seed — asserta contra el valor real de la cuenta.
    const account = await prisma.bankTransferAccount.findUniqueOrThrow({ where: { businessId: BT_VERIFY_BIZ } })
    const expectedMs = account.holdHours * 3_600_000
    expect(b.holdExpiresAt!.getTime()).toBeGreaterThanOrEqual(before + expectedMs - 5_000)
    expect(b.holdExpiresAt!.getTime()).toBeLessThanOrEqual(Date.now() + expectedMs + 5_000)
    const mpAfter = await prisma.payment.findUniqueOrThrow({ where: { id: mp.id } })
    expect(mpAfter.status).toBe('cancelled')
  })

  it('turno pasado → error', async () => {
    // Offset distinto de los usados en el describe 'confirm' (-24h/-48h/-72h) para
    // no colisionar con el EXCLUDE de solape (ventanas de 1h muy cercanas se pisan).
    const start = new Date(Date.now() - 100 * 3_600_000)
    const seeded = await seedExpired({ startDateTime: start, endDateTime: addMinutes(start, 60), holdExpiresAt: new Date(Date.now() - 106 * 3_600_000) })
    await expect(reviveBooking(seeded.bookingId, 'reopen')).rejects.toThrow('turno ya pasó')
  })

  it('reserva sin transferencia (paymentMethod null) → error', async () => {
    const seeded = await seedExpired()
    await prisma.booking.update({ where: { id: seeded.bookingId }, data: { paymentMethod: null } })
    await expect(reviveBooking(seeded.bookingId, 'reopen')).rejects.toThrow('transferencia')
  })

  it('cuenta deshabilitada → error (y se re-habilita para los demás tests)', async () => {
    const seeded = await seedExpired()
    await prisma.bankTransferAccount.update({ where: { businessId: BT_VERIFY_BIZ }, data: { isEnabled: false } })
    try {
      await expect(reviveBooking(seeded.bookingId, 'reopen')).rejects.toThrow('transferencia')
    } finally {
      await prisma.bankTransferAccount.update({ where: { businessId: BT_VERIFY_BIZ }, data: { isEnabled: true } })
    }
  })

  it('conflicto de cupo (TimeBlock) → error y sigue expired', async () => {
    const seeded = await seedExpired()
    const b = await prisma.booking.findUniqueOrThrow({ where: { id: seeded.bookingId } })
    const block = await prisma.timeBlock.create({
      data: { businessId: BT_VERIFY_BIZ, startDateTime: b.startDateTime, endDateTime: b.endDateTime, reason: 'ocupado' },
    })
    await expect(reviveBooking(seeded.bookingId, 'reopen')).rejects.toThrow('ya no está disponible')
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: seeded.bookingId } })).status).toBe('expired')
    await prisma.timeBlock.delete({ where: { id: block.id } })
  })
})
