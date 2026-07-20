import { PrismaClient, Prisma } from '@prisma/client'
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { requireTestDatabase } from './setup'

requireTestDatabase()

const BIZ = 'pkgrefund-biz-1'
const USER = 'pkgrefund-user-1'

vi.mock('@/lib/auth/server', async () => {
  // ForbiddenError debe extender el UserError REAL: así el wrapper action()
  // lo reconoce (instanceof UserError) y devuelve su mensaje en { ok:false },
  // en vez de redactarlo al genérico. Mismo contrato que producción.
  const { UserError } = await import('@/lib/actions/result')
  return {
    requireBusiness: async () => ({ businessId: BIZ, user: { id: USER } }),
    requireBusinessRole: async () => ({ businessId: BIZ, user: { id: USER } }),
    ForbiddenError: class ForbiddenError extends UserError {
      constructor(message = 'No tienes permisos') {
        super(message)
        this.name = 'ForbiddenError'
      }
    },
  }
})
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: async () => ({ success: true, remaining: 30, resetAt: 0 }) }))
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
vi.mock('@/server/actions/revalidate-business', () => ({ revalidateBusinessPublicPaths: async () => {} }))

const refundSpy = vi.fn().mockResolvedValue({ refundId: 'mp-refund-1', status: 'refunded', rawResponse: {} })
vi.mock('@/lib/payments/factory', () => ({
  getMercadoPagoProviderForBusiness: async () => ({
    name: 'mercado_pago',
    createPayment: vi.fn(), verifyPayment: vi.fn(), handleWebhook: vi.fn(),
    refundPayment: refundSpy,
  }),
}))

describe('refundPackagePurchase — refund real MP', () => {
  let prisma: PrismaClient

  beforeAll(async () => {
    prisma = new PrismaClient()
    await prisma.user.create({ data: { id: USER, email: 'pkgrefund@t.test', name: 'Owner' } })
    await prisma.business.create({ data: {
      id: BIZ, name: 'Refund Biz', slug: 'refund-biz', subdomain: 'refundbiz', ownerUserId: USER,
      city: 'Santiago', country: 'CL', currency: 'CLP', timezone: 'America/Santiago', bookingWindowDays: 90,
    } })
    await prisma.businessUser.create({ data: { id: 'pkgrefund-bu-1', businessId: BIZ, userId: USER, role: 'owner' } })
  })

  afterAll(async () => {
    await prisma.ledgerEntry.deleteMany({ where: { businessId: BIZ } })
    await prisma.payment.deleteMany({ where: { businessId: BIZ } })
    await prisma.promotionGrant.deleteMany({ where: { businessId: BIZ } })
    await prisma.packagePurchase.deleteMany({ where: { businessId: BIZ } })
    await prisma.packageProduct.deleteMany({ where: { businessId: BIZ } })
    await prisma.promotion.deleteMany({ where: { businessId: BIZ } })
    await prisma.customer.deleteMany({ where: { businessId: BIZ } })
    await prisma.businessUser.deleteMany({ where: { businessId: BIZ } })
    await prisma.business.deleteMany({ where: { id: BIZ } })
    await prisma.user.deleteMany({ where: { id: USER } })
    await prisma.$disconnect()
  })

  beforeEach(async () => {
    refundSpy.mockClear()
    await prisma.ledgerEntry.deleteMany({ where: { businessId: BIZ } })
    await prisma.payment.deleteMany({ where: { businessId: BIZ } })
    await prisma.promotionGrant.deleteMany({ where: { businessId: BIZ } })
    await prisma.packagePurchase.deleteMany({ where: { businessId: BIZ } })
    await prisma.packageProduct.deleteMany({ where: { businessId: BIZ } })
    await prisma.promotion.deleteMany({ where: { businessId: BIZ } })
    await prisma.customer.deleteMany({ where: { businessId: BIZ } })
  })

  async function getOrCreateMarkerPromotion(): Promise<string> {
    const existing = await prisma.promotion.findFirst({
      where: { businessId: BIZ, triggerType: 'granted', name: 'package-coverage', pointsCost: null },
      select: { id: true },
    })
    if (existing) return existing.id
    const created = await prisma.promotion.create({
      data: {
        businessId: BIZ, name: 'package-coverage', triggerType: 'granted',
        rewardType: 'free_service', rewardValue: 0, appliesToAll: true, isActive: true,
        metadata: { kind: 'package-coverage' } as Prisma.InputJsonValue,
      },
      select: { id: true },
    })
    return created.id
  }

  it('paquete online pagado por MP: llama refundPayment con idempotencyKey y prorrateo, deja refunded sin chargebackAt, asienta refund_issued paymentId null', async () => {
    const { refundPackagePurchase } = await import('@/server/actions/packages')

    const customer = await prisma.customer.create({ data: { businessId: BIZ, name: 'Cli', phone: '+56900000001' } })
    const product = await prisma.packageProduct.create({ data: {
      businessId: BIZ, name: 'Pack 5', quantity: 5, bonusQuantity: 0, price: 50000,
      appliesToAll: true, isActive: true,
    } })
    const purchase = await prisma.packagePurchase.create({ data: {
      businessId: BIZ, customerId: customer.id, packageProductId: product.id,
      pricePaid: 50000, quantity: 5, bonusQuantity: 0, coversAll: true, coveredServiceIds: [],
      source: 'online', status: 'active',
    } })

    // Grants activos ligados a la compra (5, sin uso) vía la promo marcador de paquetes.
    const markerId = await getOrCreateMarkerPromotion()
    for (let i = 0; i < 5; i++) {
      await prisma.promotionGrant.create({
        data: {
          businessId: BIZ, promotionId: markerId, customerId: customer.id,
          code: `PKGREFUND-${i}`, pointsSpent: 0, status: 'active',
          expiresAt: null, refundOnExpiry: false, forfeitOnNoShow: false,
          requestId: `req-pkgrefund-${i}`, packagePurchaseId: purchase.id,
        },
      })
    }

    const payment = await prisma.payment.create({ data: {
      businessId: BIZ, packagePurchaseId: purchase.id, customerId: customer.id,
      provider: 'mercado_pago', providerPaymentId: 'mp-x', amount: 50000, currency: 'CLP',
      status: 'approved', paymentType: 'package_purchase',
    } })

    const result = await refundPackagePurchase(purchase.id)
    expect(result.ok).toBe(true)

    // 5 sesiones no usadas de 5 → refund = pricePaid completo = 50000
    expect(refundSpy).toHaveBeenCalledWith(expect.objectContaining({
      providerPaymentId: 'mp-x', idempotencyKey: `refund:pkg:${purchase.id}`, amount: 50000,
    }))
    const after = await prisma.packagePurchase.findUnique({ where: { id: purchase.id } })
    expect(after!.status).toBe('refunded')
    expect(after!.chargebackAt).toBeNull()
    const entry = await prisma.ledgerEntry.findFirst({ where: { packagePurchaseId: purchase.id, type: 'refund_issued' } })
    expect(entry).not.toBeNull()
    expect(entry!.paymentId).toBeNull()
    expect(payment.id).toBeTruthy()
  })
})
