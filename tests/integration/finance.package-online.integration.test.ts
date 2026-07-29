import { PrismaClient } from '@prisma/client'
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { requireTestDatabase } from './setup'
import { applyApprovedPackagePayment } from '@/server/services/finance'
import { reversePackagePurchaseInTx } from '@/lib/packages/reverse'

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
    // La clienta también: desde #109 hay @@unique([businessId, phone]), así que
    // re-crearla con el mismo teléfono en el 2º caso viola la constraint.
    await prisma.customer.deleteMany({ where: { businessId: BIZ } })

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

  it('un SEGUNDO pago sobre la compra ya activa no duplica el paquete pero sí se asienta, fuera de los KPI', async () => {
    // Escenario real: la clienta arrancó el checkout de MP, después pagó por
    // transferencia, la dueña confirmó (compra activa) y MP aprobó tarde.
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

    const first = await prisma.payment.create({
      data: {
        businessId: BIZ, packagePurchaseId: purchase.id, customerId,
        provider: 'mercado_pago', providerPaymentId: 'mp-dup-1', amount: 50000,
        currency: 'CLP', status: 'pending', paymentType: 'package_purchase',
      },
    })

    await prisma.$transaction((tx) =>
      applyApprovedPackagePayment({
        tx, packagePurchaseId: purchase.id, businessId: BIZ, amount: 50000,
        currency: 'CLP', provider: 'mercado_pago', providerPaymentId: 'mp-dup-1',
        paymentType: 'package_purchase', paymentMethod: null, paymentId: first.id,
      }),
    )

    // Segundo pago aprobado, con su propio Payment (no es una redelivery).
    const second = await prisma.payment.create({
      data: {
        businessId: BIZ, packagePurchaseId: purchase.id, customerId,
        provider: 'mercado_pago', providerPaymentId: 'mp-dup-2', amount: 50000,
        currency: 'CLP', status: 'pending', paymentType: 'package_purchase',
      },
    })

    const res = await prisma.$transaction((tx) =>
      applyApprovedPackagePayment({
        tx, packagePurchaseId: purchase.id, businessId: BIZ, amount: 50000,
        currency: 'CLP', provider: 'mercado_pago', providerPaymentId: 'mp-dup-2',
        paymentType: 'package_purchase', paymentMethod: null, paymentId: second.id,
      }),
    )

    expect(res).toEqual({ outcome: 'unexpected' })

    // El paquete NO se duplicó: siguen siendo 6 sesiones y una sola venta.
    const grants = await prisma.promotionGrant.count({ where: { packagePurchaseId: purchase.id } })
    expect(grants).toBe(6)
    const sales = await prisma.ledgerEntry.count({
      where: { packagePurchaseId: purchase.id, type: 'package_sale' },
    })
    expect(sales).toBe(1)

    // Pero la plata cobrada de más queda asentada y rastreable.
    const dup = await prisma.ledgerEntry.findUnique({ where: { paymentId: second.id } })
    expect(dup?.type).toBe('manual_income')
    expect(dup?.amount).toBe(50000)
    expect(dup?.packagePurchaseId).toBe(purchase.id)

    // ...y fuera de los KPI de ingreso, que filtran packagePurchaseId: null
    // (reservas) o type 'package_sale' (paquetes). Ver src/server/actions/ledger.ts.
    const bookingIncome = await prisma.ledgerEntry.count({
      where: { businessId: BIZ, direction: 'income', packagePurchaseId: null },
    })
    expect(bookingIncome).toBe(0)

    // Redelivery del segundo pago: ya aprobado → no asienta de nuevo.
    const again = await prisma.$transaction((tx) =>
      applyApprovedPackagePayment({
        tx, packagePurchaseId: purchase.id, businessId: BIZ, amount: 50000,
        currency: 'CLP', provider: 'mercado_pago', providerPaymentId: 'mp-dup-2',
        paymentType: 'package_purchase', paymentMethod: null, paymentId: second.id,
      }),
    )
    expect(again).toEqual({ outcome: 'noop' })
    const entries = await prisma.ledgerEntry.count({ where: { packagePurchaseId: purchase.id } })
    expect(entries).toBe(2)
  })

  it('un pago sobre una compra YA REEMBOLSADA no revive el paquete ni explota con P2002', async () => {
    // Este es el caso que tumbaba el webhook: la reversión deja los grants en
    // `reversed` pero NO los borra, así que el activador los re-emitía con el mismo
    // (customerId, requestId) → P2002 → tx abortada → 500 → MP reintentando para
    // siempre. Con Postgres de verdad, no con un mock: el P2002 sólo aparece acá.
    const purchase = await prisma.packagePurchase.create({
      data: {
        businessId: BIZ, customerId, packageProductId: productId, pricePaid: 50000,
        quantity: 5, bonusQuantity: 1, coversAll: true, coveredServiceIds: [],
        source: 'online', status: 'pending',
      },
    })

    const first = await prisma.payment.create({
      data: {
        businessId: BIZ, packagePurchaseId: purchase.id, customerId,
        provider: 'mercado_pago', providerPaymentId: 'mp-ref-1', amount: 50000,
        currency: 'CLP', status: 'pending', paymentType: 'package_purchase',
      },
    })
    await prisma.$transaction((tx) =>
      applyApprovedPackagePayment({
        tx, packagePurchaseId: purchase.id, businessId: BIZ, amount: 50000,
        currency: 'CLP', provider: 'mercado_pago', providerPaymentId: 'mp-ref-1',
        paymentType: 'package_purchase', paymentMethod: null, paymentId: first.id,
      }),
    )

    await prisma.$transaction((tx) =>
      reversePackagePurchaseInTx(tx, { id: purchase.id, businessId: BIZ, customerId }, {
        mode: 'voluntary', amount: 50000, currency: 'CLP', paymentId: first.id, now: new Date(),
      }),
    )
    const refunded = await prisma.packagePurchase.findUnique({ where: { id: purchase.id } })
    expect(refunded?.status).toBe('refunded')

    // Pago tardío de MP sobre la compra ya reembolsada.
    const late = await prisma.payment.create({
      data: {
        businessId: BIZ, packagePurchaseId: purchase.id, customerId,
        provider: 'mercado_pago', providerPaymentId: 'mp-ref-2', amount: 50000,
        currency: 'CLP', status: 'pending', paymentType: 'package_purchase',
      },
    })
    const res = await prisma.$transaction((tx) =>
      applyApprovedPackagePayment({
        tx, packagePurchaseId: purchase.id, businessId: BIZ, amount: 50000,
        currency: 'CLP', provider: 'mercado_pago', providerPaymentId: 'mp-ref-2',
        paymentType: 'package_purchase', paymentMethod: null, paymentId: late.id,
      }),
    )

    expect(res).toEqual({ outcome: 'unexpected' })

    // La compra sigue reembolsada y los grants siguen reversados: no resucitó nada.
    const after = await prisma.packagePurchase.findUnique({ where: { id: purchase.id } })
    expect(after?.status).toBe('refunded')
    const active = await prisma.promotionGrant.count({
      where: { packagePurchaseId: purchase.id, status: 'active' },
    })
    expect(active).toBe(0)

    // Y la plata quedó asentada, trazable y fuera de los KPI.
    const entry = await prisma.ledgerEntry.findUnique({ where: { paymentId: late.id } })
    expect(entry?.type).toBe('manual_income')
    expect(entry?.description).toBe('Pago inesperado: el paquete ya se había reembolsado (revisar reembolso)')
  })
})
