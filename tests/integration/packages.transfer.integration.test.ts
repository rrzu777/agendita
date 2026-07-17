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

  it('declarePackageTransfer acepta declarar con hold VENCIDO mientras siga pending (fix zombie lado clienta)', async () => {
    const { createPackagePurchase, declarePackageTransfer } = await import('@/server/actions/packages-checkout')
    const { purchaseId } = await createPackagePurchase({
      packageProductId: productId, name: 'Cli Xfer', phone: '+56900000009', acceptedTerms: true, method: 'transfer',
    })
    // Vencer el hold a mano (el sweep todavía no corrió).
    await prisma.packagePurchase.update({ where: { id: purchaseId }, data: { holdExpiresAt: new Date('2026-01-01T00:00:00Z') } })
    await declarePackageTransfer({ purchaseId }) // NO debe tirar
    const pay = await prisma.payment.findFirst({ where: { packagePurchaseId: purchaseId } })
    expect(pay!.status).toBe('pending')
  })

  it('getPendingPackageTransfers muestra una declarada con hold VENCIDO (fix zombie lado dueña)', async () => {
    const { createPackagePurchase, declarePackageTransfer } = await import('@/server/actions/packages-checkout')
    const { getPendingPackageTransfers } = await import('@/server/actions/packages')
    const { purchaseId } = await createPackagePurchase({
      packageProductId: productId, name: 'Cli Xfer', phone: '+56900000009', acceptedTerms: true, method: 'transfer',
    })
    await declarePackageTransfer({ purchaseId })
    await prisma.packagePurchase.update({ where: { id: purchaseId }, data: { holdExpiresAt: new Date('2026-01-01T00:00:00Z') } })
    const list = await getPendingPackageTransfers()
    expect(list.map((p: { id: string }) => p.id)).toContain(purchaseId)
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

  describe('expireStaleHolds — sweep de compras de paquete', () => {
    it('expira una compra ABANDONADA (sin declarar); NO toca una declarada ni una de hold vigente', async () => {
      const { expireStaleHolds } = await import('@/lib/cron/expire-holds')
      const now = new Date('2026-07-12T12:00:00Z')

      const customer = await prisma.customer.create({ data: { businessId: BIZ, name: 'Cli', phone: '+56900000021' } })
      // Abandonada: hold vencido, SIN transferencia declarada → se expira.
      const abandoned = await prisma.packagePurchase.create({ data: {
        businessId: BIZ, customerId: customer.id, packageProductId: productId,
        pricePaid: 50000, quantity: 5, bonusQuantity: 0, coversAll: true, coveredServiceIds: [],
        source: 'online', status: 'pending', holdExpiresAt: new Date('2026-07-11T00:00:00Z'),
      } })
      // Declarada: hold vencido PERO con Payment bt-pkg-declared pending → NO se expira
      // (la plata pudo enviarse; queda para que la dueña confirme/rechace).
      const declared = await prisma.packagePurchase.create({ data: {
        businessId: BIZ, customerId: customer.id, packageProductId: productId,
        pricePaid: 50000, quantity: 5, bonusQuantity: 0, coversAll: true, coveredServiceIds: [],
        source: 'online', status: 'pending', holdExpiresAt: new Date('2026-07-11T00:00:00Z'),
      } })
      await prisma.payment.create({ data: {
        businessId: BIZ, packagePurchaseId: declared.id, customerId: customer.id,
        provider: 'manual', providerPaymentId: `bt-pkg-declared:${declared.id}`, amount: 50000, currency: 'CLP',
        status: 'pending', paymentType: 'package_purchase', paymentMethod: 'Transferencia',
      } })
      // Viva: hold en el futuro.
      const fresh = await prisma.packagePurchase.create({ data: {
        businessId: BIZ, customerId: customer.id, packageProductId: productId,
        pricePaid: 50000, quantity: 5, bonusQuantity: 0, coversAll: true, coveredServiceIds: [],
        source: 'online', status: 'pending', holdExpiresAt: new Date('2026-07-20T00:00:00Z'),
      } })

      const result = await expireStaleHolds(now)

      expect(result.packagesExpired).toBeGreaterThanOrEqual(1)
      const abandonedAfter = await prisma.packagePurchase.findUnique({ where: { id: abandoned.id } })
      expect(abandonedAfter!.status).toBe('expired')
      // La declarada sigue pending y su Payment sigue pending (no barrida).
      const declaredAfter = await prisma.packagePurchase.findUnique({ where: { id: declared.id } })
      expect(declaredAfter!.status).toBe('pending')
      const declaredPay = await prisma.payment.findFirst({ where: { packagePurchaseId: declared.id } })
      expect(declaredPay!.status).toBe('pending')
      const freshAfter = await prisma.packagePurchase.findUnique({ where: { id: fresh.id } })
      expect(freshAfter!.status).toBe('pending')
    })
  })

  describe('revive de compra expirada al declarar transferencia (spec §5)', () => {
    it('revive una expirada por transferencia: expired→pending con hold nuevo + Payment declarado + flags reset', async () => {
      const { createPackagePurchase, declarePackageTransfer } = await import('@/server/actions/packages-checkout')
      const { purchaseId } = await createPackagePurchase({
        packageProductId: productId, name: 'Cli Xfer', phone: '+56900000009', acceptedTerms: true, method: 'transfer',
      })
      // Simular el sweep: expirada sin declarar, con flag de recordatorio ya gastado.
      await prisma.packagePurchase.update({
        where: { id: purchaseId },
        data: { status: 'expired', holdExpiresAt: new Date(Date.now() - 3600_000), transferReminderCustomerSentAt: new Date() },
      })

      await declarePackageTransfer({ purchaseId })

      const p = await prisma.packagePurchase.findUnique({ where: { id: purchaseId }, include: { payments: true } })
      expect(p!.status).toBe('pending')
      expect(p!.holdExpiresAt!.getTime()).toBeGreaterThan(Date.now() + 47 * 3600_000) // holdHours=48 del seed
      expect(p!.transferReminderCustomerSentAt).toBeNull()
      expect(p!.transferReminderBusinessSentAt).toBeNull()
      const declared = p!.payments.find(x => x.providerPaymentId === `bt-pkg-declared:${purchaseId}`)
      expect(declared?.status).toBe('pending')
    })

    it('NO revive si el precio del producto cambió', async () => {
      const { createPackagePurchase, declarePackageTransfer } = await import('@/server/actions/packages-checkout')
      const { purchaseId } = await createPackagePurchase({
        packageProductId: productId, name: 'Cli Xfer', phone: '+56900000009', acceptedTerms: true, method: 'transfer',
      })
      await prisma.packagePurchase.update({ where: { id: purchaseId }, data: { status: 'expired' } })
      await prisma.packageProduct.update({ where: { id: productId }, data: { price: 60000 } })
      try {
        await expect(declarePackageTransfer({ purchaseId })).rejects.toThrow(/cambió/i)
        const p = await prisma.packagePurchase.findUnique({ where: { id: purchaseId } })
        expect(p!.status).toBe('expired')
      } finally {
        await prisma.packageProduct.update({ where: { id: productId }, data: { price: 50000 } })
      }
    })

    it('NO revive si el producto fue desactivado', async () => {
      const { createPackagePurchase, declarePackageTransfer } = await import('@/server/actions/packages-checkout')
      const { purchaseId } = await createPackagePurchase({
        packageProductId: productId, name: 'Cli Xfer', phone: '+56900000009', acceptedTerms: true, method: 'transfer',
      })
      await prisma.packagePurchase.update({ where: { id: purchaseId }, data: { status: 'expired' } })
      await prisma.packageProduct.update({ where: { id: productId }, data: { isActive: false } })
      try {
        await expect(declarePackageTransfer({ purchaseId })).rejects.toThrow(/cambió/i)
      } finally {
        await prisma.packageProduct.update({ where: { id: productId }, data: { isActive: true } })
      }
    })

    it('NO revive una expirada que no era de transferencia (paymentMethod null)', async () => {
      const { createPackagePurchase, declarePackageTransfer } = await import('@/server/actions/packages-checkout')
      // Crear vía transfer para tener customer vinculado, luego forzar el estado MP-like.
      const { purchaseId } = await createPackagePurchase({
        packageProductId: productId, name: 'Cli Xfer', phone: '+56900000009', acceptedTerms: true, method: 'transfer',
      })
      await prisma.packagePurchase.update({ where: { id: purchaseId }, data: { status: 'expired', paymentMethod: null } })
      await expect(declarePackageTransfer({ purchaseId })).rejects.toThrow(/ya fue procesada/i)
    })

    it('revivida → confirmable por la dueña → activa con grants (ciclo completo)', async () => {
      const { createPackagePurchase, declarePackageTransfer } = await import('@/server/actions/packages-checkout')
      const { confirmPackageTransfer } = await import('@/server/actions/bank-transfer-verify')
      const { purchaseId } = await createPackagePurchase({
        packageProductId: productId, name: 'Cli Xfer', phone: '+56900000009', acceptedTerms: true, method: 'transfer',
      })
      await prisma.packagePurchase.update({ where: { id: purchaseId }, data: { status: 'expired' } })
      await declarePackageTransfer({ purchaseId })
      const declared = await prisma.payment.findFirst({ where: { packagePurchaseId: purchaseId, provider: 'manual' } })
      await confirmPackageTransfer(declared!.id)
      const p = await prisma.packagePurchase.findUnique({ where: { id: purchaseId }, include: { grants: true } })
      expect(p!.status).toBe('active')
      expect(p!.grants.length).toBe(5)
    })
  })
})
