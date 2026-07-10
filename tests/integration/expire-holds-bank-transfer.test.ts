import { describe, it, expect, afterAll, vi } from 'vitest'
import { prisma } from '@/lib/db'
import { expireStaleHolds } from '@/lib/cron/expire-holds'
import { requireTestDatabase } from './setup'
import { seedDeclaredTransfer, cleanupBankTransferSeed } from './helpers/bank-transfer-seed'

requireTestDatabase()

// expireStaleHolds es un cron plano (NO llama a requireBusiness) → sin mock de
// auth. Inyectamos el sender de email vía el nuevo param `deps` para espiarlo.

afterAll(async () => {
  await cleanupBankTransferSeed()
})

describe('expireStaleHolds + declared transfers', () => {
  it('cancels the declared payment and calls the email sender for expired declared bookings', async () => {
    const { bookingId, paymentId } = await seedDeclaredTransfer({
      holdExpiresAt: new Date(Date.now() - 3600_000),
      customerEmail: 'ana@x.com',
    })
    const spy = vi.fn().mockResolvedValue({ success: true })
    await expireStaleHolds(new Date(), prisma, { sendExpiredEmail: spy })
    const payment = await prisma.payment.findUnique({ where: { id: paymentId } })
    const booking = await prisma.booking.findUnique({ where: { id: bookingId } })
    expect(booking!.status).toBe('expired')
    expect(payment!.status).toBe('cancelled')
    expect(spy).toHaveBeenCalledOnce()
  })

  it('does not email when the customer has no email', async () => {
    const { bookingId, paymentId } = await seedDeclaredTransfer({
      holdExpiresAt: new Date(Date.now() - 3600_000),
      customerEmail: null,
    })
    const spy = vi.fn().mockResolvedValue({ success: true })
    await expireStaleHolds(new Date(), prisma, { sendExpiredEmail: spy })
    const payment = await prisma.payment.findUnique({ where: { id: paymentId } })
    const booking = await prisma.booking.findUnique({ where: { id: bookingId } })
    expect(booking!.status).toBe('expired')
    expect(payment!.status).toBe('cancelled')
    expect(spy).not.toHaveBeenCalled()
  })

  it('leaves a declared transfer with a live hold untouched', async () => {
    const { bookingId, paymentId } = await seedDeclaredTransfer({
      holdExpiresAt: new Date(Date.now() + 3600_000),
    })
    await expireStaleHolds(new Date(), prisma)
    const booking = await prisma.booking.findUnique({ where: { id: bookingId } })
    const payment = await prisma.payment.findUnique({ where: { id: paymentId } })
    expect(booking!.status).toBe('pending_payment')
    expect(payment!.status).toBe('pending')
  })
})
