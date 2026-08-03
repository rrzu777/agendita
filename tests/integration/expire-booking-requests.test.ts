import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { addMinutes } from 'date-fns'
import { prisma } from '@/lib/db'
import { expireStaleHolds } from '@/lib/cron/expire-holds'
import { requireTestDatabase } from './setup'
import {
  seedDeclaredTransfer, seedConfirmedBooking, cleanupBankTransferSeed, BT_VERIFY_BIZ, BT_VERIFY_SVC,
} from './helpers/bank-transfer-seed'

requireTestDatabase()

beforeAll(async () => {
  await seedDeclaredTransfer()
})

afterAll(async () => {
  await cleanupBankTransferSeed()
  await prisma.$disconnect()
})

// Slots propios (año 2029) para no chocar con los de otros archivos.
function slot(day: number, hourUtc: number) {
  const start = new Date(Date.UTC(2029, 4, day, hourUtc, 0, 0))
  return { startDateTime: start, endDateTime: addMinutes(start, 60) }
}

function deps() {
  return {
    sendExpiredEmail: vi.fn().mockResolvedValue({ success: true }),
    sendManualExpiredEmail: vi.fn().mockResolvedValue({ success: true }),
    sendCancelledEmail: vi.fn().mockResolvedValue({ success: true }),
  }
}

describe('expireStaleHolds + solicitudes sin responder', () => {
  it('expira la solicitud vencida y le avisa a la clienta con el motivo', async () => {
    const { bookingId } = await seedConfirmedBooking({
      businessId: BT_VERIFY_BIZ, serviceId: BT_VERIFY_SVC, ...slot(1, 15),
      status: 'pending_confirmation',
      holdExpiresAt: addMinutes(new Date(), -60),
      customerEmail: 'sol@x.com',
    })
    const d = deps()
    const res = await expireStaleHolds(new Date(), prisma, d)

    const booking = await prisma.booking.findUnique({ where: { id: bookingId } })
    expect(booking!.status).toBe('expired')
    expect(res.requestsExpired).toBeGreaterThanOrEqual(1)
    expect(res.businessIds).toContain(BT_VERIFY_BIZ)
    expect(d.sendCancelledEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        customerEmail: 'sol@x.com',
        reason: 'El negocio no alcanzó a confirmar la reserva a tiempo',
      }),
    )
  })

  it('no toca una solicitud con el hold todavía vivo', async () => {
    const { bookingId } = await seedConfirmedBooking({
      businessId: BT_VERIFY_BIZ, serviceId: BT_VERIFY_SVC, ...slot(2, 15),
      status: 'pending_confirmation',
      holdExpiresAt: addMinutes(new Date(), 60),
      customerEmail: 'viva@x.com',
    })
    await expireStaleHolds(new Date(), prisma, deps())

    const booking = await prisma.booking.findUnique({ where: { id: bookingId } })
    expect(booking!.status).toBe('pending_confirmation')
  })

  it('expira aunque la reserva esté marcada fully_paid (servicio gratis)', async () => {
    // El sweep de holds de pago filtra paymentStatus: 'unpaid'. Una solicitud
    // sobre un servicio gratis nace fully_paid: si este sweep copiara ese filtro,
    // quedaría colgada para siempre ocupando el cupo.
    const { bookingId } = await seedConfirmedBooking({
      businessId: BT_VERIFY_BIZ, serviceId: BT_VERIFY_SVC, ...slot(3, 15),
      status: 'pending_confirmation',
      holdExpiresAt: addMinutes(new Date(), -60),
    })
    await prisma.booking.update({
      where: { id: bookingId },
      data: { paymentStatus: 'fully_paid', finalAmount: 0, remainingBalance: 0, depositRequired: 0 },
    })
    await expireStaleHolds(new Date(), prisma, deps())

    const booking = await prisma.booking.findUnique({ where: { id: bookingId } })
    expect(booking!.status).toBe('expired')
  })

  it('no manda email si la clienta no dejó uno', async () => {
    await seedConfirmedBooking({
      businessId: BT_VERIFY_BIZ, serviceId: BT_VERIFY_SVC, ...slot(4, 15),
      status: 'pending_confirmation',
      holdExpiresAt: addMinutes(new Date(), -60),
    })
    const d = deps()
    await expireStaleHolds(new Date(), prisma, d)
    expect(d.sendCancelledEmail).not.toHaveBeenCalled()
  })
})
