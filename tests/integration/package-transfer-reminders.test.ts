import { PrismaClient } from '@prisma/client'
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { requireTestDatabase } from './setup'
import type { ActionResult } from '@/lib/actions/result'

requireTestDatabase()

/** Desenvuelve un ActionResult: falla con un mensaje legible si la action
 *  wrappeada (action()) devolvió { ok: false } en un punto del test que
 *  espera éxito. */
async function unwrap<T>(promise: Promise<ActionResult<T>>): Promise<T> {
  const res = await promise
  if (!res.ok) throw new Error(res.error)
  return res.data
}

const BIZ = 'pkgrem-biz-1'
const USER = 'pkgrem-user-1'

vi.mock('@/lib/auth/user', () => {
  // getConfirmedSessionUser (validación remota) comparte el mismo usuario de
  // sesión que getCurrentUser en los tests; el flujo de reserva lo usa como
  // gate de vinculación desde #96.
  const sessionUser = async () => ({
    id: USER,
    email: 'pkgrem@t.test',
    email_confirmed_at: '2026-01-01T00:00:00Z',
    user_metadata: { name: 'Cli Rem' },
  })
  return { getCurrentUser: sessionUser, getConfirmedSessionUser: sessionUser }
})
vi.mock('@/lib/auth/ensure-user-row', () => ({
  ensureUserRow: async () => {}, AccountConflictError: class extends Error {},
}))
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: async () => ({ success: true, remaining: 20, resetAt: 0 }) }))
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
vi.mock('@/lib/auth/server', () => ({
  requireBusinessRole: async () => ({ businessId: BIZ, business: { id: BIZ }, user: { id: USER } }),
  ForbiddenError: class extends Error {},
}))
vi.mock('@/server/actions/revalidate-business', () => ({ revalidateBusinessPublicPaths: async () => {} }))

describe('sendTransferReminders — paquetes (integration)', () => {
  let prisma: PrismaClient
  let productId: string

  beforeAll(async () => {
    prisma = new PrismaClient()
    await prisma.user.create({ data: { id: USER, email: 'pkgrem@t.test', name: 'Cli Rem' } })
    await prisma.business.create({ data: {
      id: BIZ, name: 'Rem Biz', slug: 'pkgrem-biz', subdomain: 'pkgrembiz', ownerUserId: USER,
      city: 'Santiago', country: 'CL', currency: 'CLP', timezone: 'America/Santiago', bookingWindowDays: 90,
    } })
    // Cuenta de transferencia habilitada con holdHours=48.
    await prisma.bankTransferAccount.create({ data: {
      businessId: BIZ, isEnabled: true, accountHolder: 'Rem Biz', rut: '11.111.111-1',
      bankName: 'Banco', accountType: 'corriente', accountNumber: '123', email: 'pay@rem.test',
      holdHours: 48,
    } })
    const product = await prisma.packageProduct.create({ data: {
      businessId: BIZ, name: 'Pack 5', quantity: 5, bonusQuantity: 0, price: 50000,
      appliesToAll: true, isActive: true,
    } })
    productId = product.id
  })

  afterAll(async () => {
    await prisma.ledgerEntry.deleteMany({ where: { businessId: BIZ } })
    await prisma.payment.deleteMany({ where: { businessId: BIZ } })
    await prisma.promotionGrant.deleteMany({ where: { businessId: BIZ } })
    await prisma.packagePurchase.deleteMany({ where: { businessId: BIZ } })
    await prisma.promotion.deleteMany({ where: { businessId: BIZ } })
    await prisma.packageProduct.deleteMany({ where: { businessId: BIZ } })
    await prisma.bankTransferAccount.deleteMany({ where: { businessId: BIZ } })
    await prisma.customer.deleteMany({ where: { businessId: BIZ } })
    await prisma.business.deleteMany({ where: { id: BIZ } })
    await prisma.user.deleteMany({ where: { id: USER } })
    await prisma.$disconnect()
  })

  beforeEach(async () => {
    await prisma.ledgerEntry.deleteMany({ where: { businessId: BIZ } })
    await prisma.payment.deleteMany({ where: { businessId: BIZ } })
    await prisma.promotionGrant.deleteMany({ where: { businessId: BIZ } })
    await prisma.packagePurchase.deleteMany({ where: { businessId: BIZ } })
    await prisma.promotion.deleteMany({ where: { businessId: BIZ } })
    await prisma.customer.deleteMany({ where: { businessId: BIZ } })
  })

  it('recordatorio clienta: claim + envío una sola vez, y no toca declaradas', async () => {
    const { createPackagePurchase, declarePackageTransfer } = await import('@/server/actions/packages-checkout')
    const { sendTransferReminders } = await import('@/lib/cron/transfer-reminders')
    const { purchaseId } = await unwrap(createPackagePurchase({
      packageProductId: productId, name: 'Cli Rem', phone: '+56900000010', acceptedTerms: true, method: 'transfer',
    }))
    await prisma.packagePurchase.update({ where: { id: purchaseId }, data: { holdExpiresAt: new Date(Date.now() + 2 * 3600_000) } })

    const deps = {
      sendCustomer: vi.fn().mockResolvedValue({ success: true }),
      sendBusiness: vi.fn().mockResolvedValue([{ success: true }]),
      sendPkgCustomer: vi.fn().mockResolvedValue({ success: true }),
      sendPkgBusiness: vi.fn().mockResolvedValue([{ success: true }]),
    }
    const r1 = await sendTransferReminders(new Date(), prisma, deps as never)
    expect(r1.packageCustomerSent).toBe(1)
    const r2 = await sendTransferReminders(new Date(), prisma, deps as never)
    expect(r2.packageCustomerSent).toBe(0)
    expect(deps.sendPkgCustomer).toHaveBeenCalledTimes(1)

    // Declarada: no cae en la rama clienta aunque el hold esté por vencer.
    await unwrap(declarePackageTransfer({ purchaseId }))
    await prisma.packagePurchase.update({ where: { id: purchaseId }, data: { transferReminderCustomerSentAt: null } })
    const r3 = await sendTransferReminders(new Date(), prisma, deps as never)
    expect(r3.packageCustomerSent).toBe(0)
  })

  it('recordatorio dueña: declarada hace >=24h dispara una sola vez', async () => {
    const { createPackagePurchase, declarePackageTransfer } = await import('@/server/actions/packages-checkout')
    const { sendTransferReminders } = await import('@/lib/cron/transfer-reminders')
    const { purchaseId } = await unwrap(createPackagePurchase({
      packageProductId: productId, name: 'Cli Rem', phone: '+56900000010', acceptedTerms: true, method: 'transfer',
    }))
    await unwrap(declarePackageTransfer({ purchaseId }))
    await prisma.payment.updateMany({
      where: { packagePurchaseId: purchaseId, provider: 'manual' },
      data: { createdAt: new Date(Date.now() - 25 * 3600_000) },
    })
    const deps = {
      sendCustomer: vi.fn(), sendBusiness: vi.fn(),
      sendPkgCustomer: vi.fn(), sendPkgBusiness: vi.fn().mockResolvedValue([{ success: true }]),
    }
    const r1 = await sendTransferReminders(new Date(), prisma, deps as never)
    expect(r1.packageBusinessSent).toBe(1)
    const r2 = await sendTransferReminders(new Date(), prisma, deps as never)
    expect(r2.packageBusinessSent).toBe(0)
    expect(deps.sendPkgBusiness).toHaveBeenCalledTimes(1)
  })
})
