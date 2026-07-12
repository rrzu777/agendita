import { PrismaClient } from '@prisma/client'
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { requireTestDatabase } from './setup'
import { applyApprovedPackagePayment } from '@/server/services/finance'

requireTestDatabase()

// Prueba de extremo a extremo de la compra online de un paquete (B4b-2): un
// pago aprobado activa la PackagePurchase, emite los grants (quantity+bonus),
// asienta el ledger `package_sale` y la compra queda visible por el userId
// vinculado del Customer (el seam que usa /mi). Sigue el precedente de
// tests/integration/packages-consume.test.ts y packages-actions.test.ts:
// Postgres real, sin mocks de Prisma.
const BIZ = 'pkgonline-biz-1'
const OWNER_USER = 'pkgonline-owner-1'
const CUSTOMER_USER = 'pkgonline-customer-user-1'

describe('compra online de paquete (integración)', () => {
  let prisma: PrismaClient
  let customerId: string
  let productId: string

  beforeAll(async () => {
    prisma = new PrismaClient()

    await prisma.ledgerEntry.deleteMany()
    await prisma.payment.deleteMany()
    await prisma.promotionGrant.deleteMany()
    await prisma.packagePurchase.deleteMany()
    await prisma.packageProduct.deleteMany()
    await prisma.promotion.deleteMany()
    await prisma.customer.deleteMany()
    await prisma.businessUser.deleteMany()
    await prisma.business.deleteMany()
    await prisma.user.deleteMany({ where: { id: { in: [OWNER_USER, CUSTOMER_USER] } } })

    await prisma.user.create({
      data: { id: OWNER_USER, email: 'owner@pkgonline.test', name: 'Pkg Online Owner' },
    })
    await prisma.user.create({
      data: { id: CUSTOMER_USER, email: 'cliente@pkgonline.test', name: 'Pkg Online Cliente' },
    })

    await prisma.business.create({
      data: {
        id: BIZ,
        name: 'Pkg Online Biz',
        slug: 'pkg-online-biz',
        subdomain: 'pkgonline',
        ownerUserId: OWNER_USER,
        city: 'Santiago',
        country: 'CL',
        currency: 'CLP',
        timezone: 'America/Santiago',
        bookingWindowDays: 90,
      },
    })

    await prisma.businessUser.create({
      data: { id: 'pkgonline-bu-1', businessId: BIZ, userId: OWNER_USER, role: 'owner' },
    })
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
    await prisma.user.deleteMany({ where: { id: { in: [OWNER_USER, CUSTOMER_USER] } } })
    await prisma.$disconnect()
  })

  beforeEach(async () => {
    await prisma.ledgerEntry.deleteMany({ where: { businessId: BIZ } })
    await prisma.payment.deleteMany({ where: { businessId: BIZ } })
    await prisma.promotionGrant.deleteMany({ where: { businessId: BIZ } })
    await prisma.packagePurchase.deleteMany({ where: { businessId: BIZ } })
    await prisma.packageProduct.deleteMany({ where: { businessId: BIZ } })

    const customer = await prisma.customer.create({
      data: {
        businessId: BIZ,
        name: 'Cliente Online',
        phone: '+56911119999',
        email: 'cliente@pkgonline.test',
        userId: CUSTOMER_USER,
      },
    })
    customerId = customer.id

    const product = await prisma.packageProduct.create({
      data: {
        businessId: BIZ,
        name: 'Pack 5+1 online',
        quantity: 5,
        bonusQuantity: 1,
        price: 50000,
        appliesToAll: true,
        isActive: true,
      },
    })
    productId = product.id
  })

  it('approved activa la compra, emite grants, asienta el ledger y queda visible por userId', async () => {
    const purchase = await prisma.packagePurchase.create({
      data: {
        businessId: BIZ,
        customerId,
        packageProductId: productId,
        pricePaid: 50000,
        quantity: 5,
        bonusQuantity: 1,
        coversAll: true,
        coveredServiceIds: [],
        source: 'online',
        status: 'pending',
      },
    })

    const payment = await prisma.payment.create({
      data: {
        businessId: BIZ,
        packagePurchaseId: purchase.id,
        customerId,
        provider: 'mercado_pago',
        providerPaymentId: 'mp-online-1',
        amount: 50000,
        currency: 'CLP',
        status: 'pending',
        paymentType: 'package_purchase',
      },
    })

    await prisma.$transaction((tx) =>
      applyApprovedPackagePayment({
        tx,
        packagePurchaseId: purchase.id,
        businessId: BIZ,
        amount: 50000,
        currency: 'CLP',
        provider: 'mercado_pago',
        providerPaymentId: 'mp-online-1',
        paymentType: 'package_purchase',
        paymentMethod: null,
        paymentId: payment.id,
      }),
    )

    const activated = await prisma.packagePurchase.findUnique({ where: { id: purchase.id } })
    expect(activated?.status).toBe('active')

    const grants = await prisma.promotionGrant.count({ where: { packagePurchaseId: purchase.id } })
    expect(grants).toBe(6)

    const ledger = await prisma.ledgerEntry.findFirst({
      where: { packagePurchaseId: purchase.id, type: 'package_sale' },
    })
    expect(ledger).not.toBeNull()
    expect(ledger?.amount).toBe(50000)

    const viaUser = await prisma.packagePurchase.findMany({
      where: { customer: { userId: CUSTOMER_USER }, status: 'active' },
    })
    expect(viaUser).toHaveLength(1)
    expect(viaUser[0]?.id).toBe(purchase.id)
  })
})
