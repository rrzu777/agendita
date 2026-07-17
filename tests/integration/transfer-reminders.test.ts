import { describe, it, expect, afterAll, beforeEach, vi } from 'vitest'
import { prisma } from '@/lib/db'
import { sendTransferReminders } from '@/lib/cron/transfer-reminders'
import { requireTestDatabase } from './setup'
import {
  seedDeclaredTransfer,
  cleanupBankTransferSeed,
  BT_VERIFY_BIZ,
} from './helpers/bank-transfer-seed'

requireTestDatabase()

// sendTransferReminders es un cron plano (sin requireBusiness) → sin mock de auth.
// Los senders se inyectan vía `deps` para espiarlos sin mandar emails reales.

function makeDeps() {
  const sendCustomer = vi.fn().mockResolvedValue({ success: true })
  const sendBusiness = vi.fn().mockResolvedValue([{ success: true }])
  const sendPkgCustomer = vi.fn().mockResolvedValue({ success: true })
  const sendPkgBusiness = vi.fn().mockResolvedValue([{ success: true }])
  return { sendCustomer, sendBusiness, sendPkgCustomer, sendPkgBusiness }
}

// Aislamiento por test: el cron procesa estado GLOBAL, así que limpiamos las
// reservas/pagos/clientas del negocio sembrado y reseteamos la cuenta a su
// baseline (holdHours 24 / verifyHours 48 / enabled) antes de cada caso.
beforeEach(async () => {
  await prisma.payment.deleteMany({ where: { businessId: BT_VERIFY_BIZ } })
  await prisma.booking.deleteMany({ where: { businessId: BT_VERIFY_BIZ } })
  await prisma.customer.deleteMany({ where: { businessId: BT_VERIFY_BIZ } })
  await prisma.bankTransferAccount.updateMany({
    where: { businessId: BT_VERIFY_BIZ },
    data: { holdHours: 24, verifyHours: 48, isEnabled: true },
  })
})

afterAll(async () => {
  await cleanupBankTransferSeed()
})

describe('sendTransferReminders (integration)', () => {
  it('(a) undeclared transfer, hold +2h → reminds customer once and marks the flag', async () => {
    const { bookingId } = await seedDeclaredTransfer({
      declared: false,
      holdExpiresAt: new Date(Date.now() + 2 * 3600_000),
      customerEmail: 'ana@x.com',
    })
    const deps = makeDeps()

    const res1 = await sendTransferReminders(new Date(), prisma, deps)
    expect(res1.customerSent).toBe(1)
    expect(deps.sendCustomer).toHaveBeenCalledOnce()
    const booking = await prisma.booking.findUnique({ where: { id: bookingId } })
    expect(booking!.transferReminderCustomerSentAt).not.toBeNull()

    // Segunda corrida: no reenvía (flag ya seteado).
    const res2 = await sendTransferReminders(new Date(), prisma, deps)
    expect(res2.customerSent).toBe(0)
    expect(deps.sendCustomer).toHaveBeenCalledOnce()
  })

  it('(b) declared transfer, hold +5h → reminds the business owner', async () => {
    const { bookingId } = await seedDeclaredTransfer({
      holdExpiresAt: new Date(Date.now() + 5 * 3600_000),
    })
    const deps = makeDeps()

    const res = await sendTransferReminders(new Date(), prisma, deps)
    expect(res.businessSent).toBe(1)
    expect(deps.sendBusiness).toHaveBeenCalledOnce()
    expect(deps.sendCustomer).not.toHaveBeenCalled()
    const booking = await prisma.booking.findUnique({ where: { id: bookingId } })
    expect(booking!.transferReminderBusinessSentAt).not.toBeNull()
  })

  it('(c) declared transfer with verifyHours=null (hold NULL) + payment ~25h old → reminds the business owner', async () => {
    const { bookingId, paymentId } = await seedDeclaredTransfer({
      holdExpiresAt: null,
    })
    // El Payment.createdAt es @default(now()); lo envejecemos a 25h atrás.
    await prisma.payment.update({
      where: { id: paymentId },
      data: { createdAt: new Date(Date.now() - 25 * 3600_000) },
    })
    const deps = makeDeps()

    const res = await sendTransferReminders(new Date(), prisma, deps)
    expect(res.businessSent).toBe(1)
    expect(deps.sendBusiness).toHaveBeenCalledOnce()
    const booking = await prisma.booking.findUnique({ where: { id: bookingId } })
    expect(booking!.transferReminderBusinessSentAt).not.toBeNull()
  })

  it('(d) hold +2h but with a pending Mercado Pago payment → does NOT remind the customer', async () => {
    const { bookingId, customerId } = await seedDeclaredTransfer({
      declared: false,
      holdExpiresAt: new Date(Date.now() + 2 * 3600_000),
    })
    await prisma.payment.create({
      data: {
        businessId: BT_VERIFY_BIZ,
        bookingId,
        customerId,
        provider: 'mercado_pago',
        providerPaymentId: `mp-${bookingId}`,
        amount: 10000,
        currency: 'CLP',
        status: 'pending',
        paymentType: 'deposit',
        paymentMethod: 'MercadoPago',
      },
    })
    const deps = makeDeps()

    const res = await sendTransferReminders(new Date(), prisma, deps)
    expect(res.customerSent).toBe(0)
    expect(deps.sendCustomer).not.toHaveBeenCalled()
    const booking = await prisma.booking.findUnique({ where: { id: bookingId } })
    expect(booking!.transferReminderCustomerSentAt).toBeNull()
  })

  it('(e) hold +2h but account holdHours=2 (≤ window) → does NOT remind the customer', async () => {
    const { bookingId } = await seedDeclaredTransfer({
      declared: false,
      holdExpiresAt: new Date(Date.now() + 2 * 3600_000),
    })
    await prisma.bankTransferAccount.update({
      where: { businessId: BT_VERIFY_BIZ },
      data: { holdHours: 2 },
    })
    const deps = makeDeps()

    const res = await sendTransferReminders(new Date(), prisma, deps)
    expect(res.customerSent).toBe(0)
    expect(deps.sendCustomer).not.toHaveBeenCalled()
    const booking = await prisma.booking.findUnique({ where: { id: bookingId } })
    expect(booking!.transferReminderCustomerSentAt).toBeNull()
  })
})
