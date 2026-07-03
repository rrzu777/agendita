import { PrismaClient } from '@prisma/client'
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { requireTestDatabase } from './setup'
import { computePackageRefund } from '@/lib/packages/schema'

requireTestDatabase()

// Approach: estas server actions envuelven su lógica con requireBusinessRole (auth),
// checkRateLimit y revalidatePath. Siguiendo el precedente de
// tests/integration/time-block-series.test.ts, mockeamos esas capas para poder
// ejercitar la LÓGICA REAL de las actions contra un Postgres real (los grants,
// la promo marcador y la compra se crean/consultan con Prisma de verdad).
const BIZ = 'pkg-biz-1'
const USER = 'pkg-user-1'
vi.mock('@/lib/auth/server', () => ({
  requireBusiness: async () => ({ businessId: BIZ, user: { id: USER } }),
  requireBusinessRole: async () => ({ businessId: BIZ, user: { id: USER } }),
  ForbiddenError: class extends Error {},
}))
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: async () => ({ success: true, remaining: 30, resetAt: 0 }) }))
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))

describe('packages server actions', () => {
  let prisma: PrismaClient

  beforeAll(async () => {
    prisma = new PrismaClient()
    const u = await prisma.user.create({ data: { id: USER, email: 'pkg@t.test', name: 'Pkg Owner' } })
    await prisma.business.create({
      data: {
        id: BIZ, name: 'Pkg Biz', slug: 'pkg-biz', subdomain: 'pkgbiz', ownerUserId: u.id,
        city: 'Santiago', country: 'CL', currency: 'CLP', timezone: 'America/Santiago', bookingWindowDays: 90,
      },
    })
    await prisma.businessUser.create({ data: { id: 'pkg-bu-1', businessId: BIZ, userId: USER, role: 'owner' } })
  })

  afterAll(async () => {
    await prisma.promotionGrant.deleteMany({ where: { businessId: BIZ } })
    await prisma.packagePurchase.deleteMany({ where: { businessId: BIZ } })
    await prisma.packageProduct.deleteMany({ where: { businessId: BIZ } })
    await prisma.promotion.deleteMany({ where: { businessId: BIZ } })
    await prisma.service.deleteMany({ where: { businessId: BIZ } })
    await prisma.customer.deleteMany({ where: { businessId: BIZ } })
    await prisma.businessUser.deleteMany({ where: { businessId: BIZ } })
    await prisma.business.deleteMany({ where: { id: BIZ } })
    await prisma.user.deleteMany({ where: { id: USER } })
    await prisma.$disconnect()
  })

  beforeEach(async () => {
    // Limpieza entre tests para aislar conteos de grants/compras/promos marcador.
    await prisma.promotionGrant.deleteMany({ where: { businessId: BIZ } })
    await prisma.packagePurchase.deleteMany({ where: { businessId: BIZ } })
    await prisma.packageProduct.deleteMany({ where: { businessId: BIZ } })
    await prisma.promotion.deleteMany({ where: { businessId: BIZ } })
    await prisma.service.deleteMany({ where: { businessId: BIZ } })
    await prisma.customer.deleteMany({ where: { businessId: BIZ } })
  })

  it('sellPackage crea 1 compra (snapshot) + 6 grants activos y es idempotente por requestId', async () => {
    const { sellPackage } = await import('@/server/actions/packages')
    const svc = await prisma.service.create({
      data: { businessId: BIZ, name: 'Corte', durationMinutes: 30, price: 10000, depositAmount: 0, pastelColor: '#FFD700' },
    })
    const product = await prisma.packageProduct.create({
      data: {
        businessId: BIZ, name: 'Pack 5+1', quantity: 5, bonusQuantity: 1, price: 45000,
        appliesToAll: false, isActive: true, services: { connect: { id: svc.id } },
      },
    })
    const customer = await prisma.customer.create({ data: { businessId: BIZ, name: 'Ana', phone: '56911111111' } })

    const requestId = 'req-sell-1'
    await sellPackage({ packageProductId: product.id, customerId: customer.id, paymentMethod: 'cash', requestId })

    const purchases = await prisma.packagePurchase.findMany({ where: { businessId: BIZ } })
    expect(purchases).toHaveLength(1)
    const p = purchases[0]
    expect(p.coversAll).toBe(false)
    expect(p.coveredServiceIds).toEqual([svc.id])
    expect(p.quantity).toBe(5)
    expect(p.bonusQuantity).toBe(1)
    expect(p.pricePaid).toBe(45000)
    expect(p.source).toBe('manual')
    expect(p.status).toBe('active')

    const grants = await prisma.promotionGrant.findMany({ where: { packagePurchaseId: p.id } })
    expect(grants).toHaveLength(6)
    expect(grants.every(g => g.status === 'active')).toBe(true)
    expect(grants.every(g => g.pointsSpent === 0)).toBe(true)
    const codes = new Set(grants.map(g => g.code))
    expect(codes.size).toBe(6) // códigos únicos

    // Reintento con el MISMO requestId → no duplica (idempotente).
    await sellPackage({ packageProductId: product.id, customerId: customer.id, paymentMethod: 'cash', requestId })
    const purchasesAfter = await prisma.packagePurchase.findMany({ where: { businessId: BIZ } })
    expect(purchasesAfter).toHaveLength(1)
    const grantsAfter = await prisma.promotionGrant.count({ where: { packagePurchaseId: p.id } })
    expect(grantsAfter).toBe(6)
  })

  it('refundPackagePurchase reversa grants activos, marca refunded y es idempotente', async () => {
    const { sellPackage, refundPackagePurchase } = await import('@/server/actions/packages')
    const product = await prisma.packageProduct.create({
      data: { businessId: BIZ, name: 'Pack all', quantity: 4, bonusQuantity: 0, price: 40000, appliesToAll: true, isActive: true },
    })
    const customer = await prisma.customer.create({ data: { businessId: BIZ, name: 'Bea', phone: '56922222222' } })
    await sellPackage({ packageProductId: product.id, customerId: customer.id, paymentMethod: null, requestId: 'req-refund-1' })
    const purchase = await prisma.packagePurchase.findFirstOrThrow({ where: { businessId: BIZ, customerId: customer.id } })

    const expectedRefund = computePackageRefund({ pricePaid: 40000, quantity: 4, bonusQuantity: 0, unusedSessions: 4 })

    await refundPackagePurchase(purchase.id)
    const refunded = await prisma.packagePurchase.findUniqueOrThrow({ where: { id: purchase.id } })
    expect(refunded.status).toBe('refunded')
    expect(refunded.refundedAt).not.toBeNull()
    expect(refunded.refundedAmount).toBe(expectedRefund)
    const active = await prisma.promotionGrant.count({ where: { packagePurchaseId: purchase.id, status: 'active' } })
    expect(active).toBe(0)
    const reversed = await prisma.promotionGrant.count({ where: { packagePurchaseId: purchase.id, status: 'reversed' } })
    expect(reversed).toBe(4)

    // Idempotente: segunda llamada no cambia nada.
    await refundPackagePurchase(purchase.id)
    const refunded2 = await prisma.packagePurchase.findUniqueOrThrow({ where: { id: purchase.id } })
    expect(refunded2.refundedAmount).toBe(expectedRefund)
    const reversed2 = await prisma.promotionGrant.count({ where: { packagePurchaseId: purchase.id, status: 'reversed' } })
    expect(reversed2).toBe(4)
  })

  it('getActivePackagesForCustomer cuenta grants que cubren el servicio y excluye vencidos/otra cobertura', async () => {
    const { sellPackage, getActivePackagesForCustomer } = await import('@/server/actions/packages')
    const svcA = await prisma.service.create({
      data: { businessId: BIZ, name: 'A', durationMinutes: 30, price: 10000, depositAmount: 0, pastelColor: '#FFD700' },
    })
    const svcB = await prisma.service.create({
      data: { businessId: BIZ, name: 'B', durationMinutes: 30, price: 10000, depositAmount: 0, pastelColor: '#FFA500' },
    })
    // Producto que cubre solo svcA, sin vencimiento → 3 sesiones.
    const productA = await prisma.packageProduct.create({
      data: { businessId: BIZ, name: 'Pack A', quantity: 3, bonusQuantity: 0, price: 30000, appliesToAll: false, isActive: true, services: { connect: { id: svcA.id } } },
    })
    const customer = await prisma.customer.create({ data: { businessId: BIZ, name: 'Cata', phone: '56933333333' } })
    await sellPackage({ packageProductId: productA.id, customerId: customer.id, paymentMethod: null, requestId: 'req-count-A' })

    // Cubre svcA (3 activos, no vencidos).
    const forA = await getActivePackagesForCustomer({ businessId: BIZ, phone: '56933333333', serviceId: svcA.id })
    expect(forA.remaining).toBe(3)

    // No cubre svcB (cobertura distinta).
    const forB = await getActivePackagesForCustomer({ businessId: BIZ, phone: '56933333333', serviceId: svcB.id })
    expect(forB.remaining).toBe(0)

    // Vencidos: bajamos expiresAt de la compra + grants al pasado → no cuentan.
    const purchaseA = await prisma.packagePurchase.findFirstOrThrow({ where: { businessId: BIZ, customerId: customer.id } })
    const past = new Date(Date.now() - 86_400_000)
    await prisma.packagePurchase.update({ where: { id: purchaseA.id }, data: { expiresAt: past } })
    await prisma.promotionGrant.updateMany({ where: { packagePurchaseId: purchaseA.id }, data: { expiresAt: past } })
    const forAExpired = await getActivePackagesForCustomer({ businessId: BIZ, phone: '56933333333', serviceId: svcA.id })
    expect(forAExpired.remaining).toBe(0)

    // Cliente inexistente / teléfono desconocido → 0.
    const unknown = await getActivePackagesForCustomer({ businessId: BIZ, phone: '56999999999', serviceId: svcA.id })
    expect(unknown.remaining).toBe(0)
  })
})
