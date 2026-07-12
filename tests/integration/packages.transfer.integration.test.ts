import { PrismaClient } from '@prisma/client'
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { requireTestDatabase } from './setup'

requireTestDatabase()

const BIZ = 'pkgxfer-biz-1'
const USER = 'pkgxfer-user-1'

vi.mock('@/lib/auth/user', () => ({
  getCurrentUser: async () => ({
    id: USER,
    email: 'pkgxfer@t.test',
    email_confirmed_at: '2026-01-01T00:00:00Z',
    user_metadata: { name: 'Cli Xfer' },
  }),
}))
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

describe('createPackagePurchase + declarePackageTransfer (transferencia)', () => {
  let prisma: PrismaClient
  let productId: string

  beforeAll(async () => {
    prisma = new PrismaClient()
    await prisma.user.create({ data: { id: USER, email: 'pkgxfer@t.test', name: 'Cli Xfer' } })
    await prisma.business.create({ data: {
      id: BIZ, name: 'Xfer Biz', slug: 'xfer-biz', subdomain: 'xferbiz', ownerUserId: USER,
      city: 'Santiago', country: 'CL', currency: 'CLP', timezone: 'America/Santiago', bookingWindowDays: 90,
    } })
    // Cuenta de transferencia habilitada con holdHours=48.
    await prisma.bankTransferAccount.create({ data: {
      businessId: BIZ, isEnabled: true, accountHolder: 'Xfer Biz', rut: '11.111.111-1',
      bankName: 'Banco', accountType: 'corriente', accountNumber: '123', email: 'pay@xfer.test',
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

  it('crea compra pending con hold = holdHours (48h) y source online', async () => {
    const { createPackagePurchase } = await import('@/server/actions/packages-checkout')
    const before = Date.now()
    const { purchaseId } = await createPackagePurchase({
      packageProductId: productId, name: 'Cli Xfer', phone: '+56900000009', acceptedTerms: true, method: 'transfer',
    })
    const p = await prisma.packagePurchase.findUnique({ where: { id: purchaseId } })
    expect(p!.status).toBe('pending')
    expect(p!.source).toBe('online')
    const holdMs = p!.holdExpiresAt!.getTime() - before
    // ~48h en ms; tolerancia amplia
    expect(holdMs).toBeGreaterThan(47 * 3600 * 1000)
    expect(holdMs).toBeLessThan(49 * 3600 * 1000)
  })

  it('declarePackageTransfer crea un Payment manual bt-pkg-declared pending, idempotente', async () => {
    const { createPackagePurchase, declarePackageTransfer } = await import('@/server/actions/packages-checkout')
    const { purchaseId } = await createPackagePurchase({
      packageProductId: productId, name: 'Cli Xfer', phone: '+56900000009', acceptedTerms: true, method: 'transfer',
    })
    await declarePackageTransfer({ purchaseId })
    await declarePackageTransfer({ purchaseId }) // idempotente
    const pays = await prisma.payment.findMany({ where: { packagePurchaseId: purchaseId } })
    expect(pays).toHaveLength(1)
    const pay = pays[0]
    expect(pay.provider).toBe('manual')
    expect(pay.status).toBe('pending')
    expect(pay.providerPaymentId).toBe(`bt-pkg-declared:${purchaseId}`)
    expect(pay.paymentMethod).toBe('Transferencia')
    expect(pay.amount).toBe(50000)
  })

  describe('confirmar / rechazar transferencia de paquete (dueña)', () => {
    async function seedDeclared(prisma: PrismaClient) {
      const { createPackagePurchase, declarePackageTransfer } = await import('@/server/actions/packages-checkout')
      const { purchaseId } = await createPackagePurchase({
        packageProductId: productId, name: 'Cli Xfer', phone: '+56900000009', acceptedTerms: true, method: 'transfer',
      })
      await declarePackageTransfer({ purchaseId })
      const payment = await prisma.payment.findFirstOrThrow({ where: { packagePurchaseId: purchaseId, provider: 'manual' } })
      return { purchaseId, paymentId: payment.id }
    }

    it('confirmar activa la compra (grants + ledger package_sale), Payment approved', async () => {
      const { confirmPackageTransfer } = await import('@/server/actions/bank-transfer-verify')
      const { purchaseId, paymentId } = await seedDeclared(prisma)
      await confirmPackageTransfer(paymentId)

      const purchase = await prisma.packagePurchase.findUnique({ where: { id: purchaseId } })
      expect(purchase!.status).toBe('active')
      const payment = await prisma.payment.findUnique({ where: { id: paymentId } })
      expect(payment!.status).toBe('approved')
      const grants = await prisma.promotionGrant.count({ where: { packagePurchaseId: purchaseId, status: 'active' } })
      expect(grants).toBe(5) // quantity 5 + bonus 0
      const sale = await prisma.ledgerEntry.findFirst({ where: { packagePurchaseId: purchaseId, type: 'package_sale' } })
      expect(sale).not.toBeNull()
    })

    it('rechazar deja Payment rejected y compra rejected, sin grants ni ledger', async () => {
      const { rejectPackageTransfer } = await import('@/server/actions/bank-transfer-verify')
      const { purchaseId, paymentId } = await seedDeclared(prisma)
      await rejectPackageTransfer(paymentId)

      const purchase = await prisma.packagePurchase.findUnique({ where: { id: purchaseId } })
      expect(purchase!.status).toBe('rejected')
      const payment = await prisma.payment.findUnique({ where: { id: paymentId } })
      expect(payment!.status).toBe('rejected')
      const grants = await prisma.promotionGrant.count({ where: { packagePurchaseId: purchaseId } })
      expect(grants).toBe(0)
      const sale = await prisma.ledgerEntry.findFirst({ where: { packagePurchaseId: purchaseId, type: 'package_sale' } })
      expect(sale).toBeNull()
    })
  })
})
