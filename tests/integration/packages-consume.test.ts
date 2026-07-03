import { PrismaClient, BookingStatus, BookingPaymentStatus } from '@prisma/client'
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { requireTestDatabase } from './setup'
import { applyPackageInTx } from '@/lib/packages/consume'

requireTestDatabase()

const FAKE_NOW = new Date('2026-06-01T12:00:00Z')

describe('packages consume integration', () => {
  let prisma: PrismaClient
  let biz: { id: string; timezone: string }
  let svc: { id: string; durationMinutes: number; price: number; depositAmount: number }
  let cust: { id: string }
  let promo: { id: string }

  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(FAKE_NOW)

    prisma = new PrismaClient()

    await prisma.promotionRedemption.deleteMany()
    await prisma.promotionGrant.deleteMany()
    await prisma.packagePurchase.deleteMany()
    await prisma.packageProduct.deleteMany()
    await prisma.promotion.deleteMany()
    await prisma.ledgerEntry.deleteMany()
    await prisma.payment.deleteMany()
    await prisma.booking.deleteMany()
    await prisma.review.deleteMany()
    await prisma.timeBlock.deleteMany()
    await prisma.availabilityRule.deleteMany()
    await prisma.customer.deleteMany()
    await prisma.service.deleteMany()
    await prisma.businessUser.deleteMany()
    await prisma.business.deleteMany()
    await prisma.user.deleteMany()

    const user = await prisma.user.create({
      data: { id: 'itpc-u1', email: 'owner@pkgconsume.test', name: 'Pkg Consume Owner' },
    })

    biz = await prisma.business.create({
      data: {
        id: 'itpc-b1',
        name: 'Pkg Consume Biz',
        slug: 'pkg-consume-biz',
        subdomain: 'pkgconsume',
        ownerUserId: user.id,
        city: 'Santiago',
        country: 'CL',
        currency: 'CLP',
        timezone: 'America/Santiago',
        bookingWindowDays: 90,
      },
    })

    await prisma.businessUser.create({
      data: { id: 'itpc-bu1', businessId: biz.id, userId: user.id, role: 'owner' },
    })

    svc = await prisma.service.create({
      data: {
        id: 'itpc-s1',
        businessId: biz.id,
        name: 'Pkg Consume Service',
        durationMinutes: 60,
        price: 20000,
        depositAmount: 10000,
        pastelColor: '#FFD700',
      },
    })

    cust = await prisma.customer.create({
      data: {
        id: 'itpc-c1',
        businessId: biz.id,
        name: 'Pkg Consume Customer',
        phone: '+56911112222',
        email: 'pkgconsume@test.com',
      },
    })

    promo = await prisma.promotion.create({
      data: {
        id: 'itpc-promo1',
        businessId: biz.id,
        name: 'Paquete marcador',
        triggerType: 'granted',
        rewardType: 'free_service',
        rewardValue: 0,
        appliesToAll: true,
        isActive: true,
      },
    })
  })

  afterAll(async () => {
    await prisma.promotionRedemption.deleteMany()
    await prisma.promotionGrant.deleteMany()
    await prisma.packagePurchase.deleteMany()
    await prisma.packageProduct.deleteMany()
    await prisma.promotion.deleteMany()
    await prisma.ledgerEntry.deleteMany()
    await prisma.payment.deleteMany()
    await prisma.booking.deleteMany()
    await prisma.review.deleteMany()
    await prisma.timeBlock.deleteMany()
    await prisma.availabilityRule.deleteMany()
    await prisma.customer.deleteMany()
    await prisma.service.deleteMany()
    await prisma.businessUser.deleteMany()
    await prisma.business.deleteMany()
    await prisma.user.deleteMany()
    await prisma.$disconnect()
    vi.useRealTimers()
  })

  beforeEach(async () => {
    await prisma.promotionRedemption.deleteMany()
    await prisma.promotionGrant.deleteMany()
    await prisma.packagePurchase.deleteMany()
    await prisma.booking.deleteMany()
    vi.setSystemTime(FAKE_NOW)
  })

  function futureDate(daysAhead: number, hourUTC: number) {
    const d = new Date()
    d.setUTCDate(d.getUTCDate() + daysAhead)
    d.setUTCHours(hourUTC, 0, 0, 0)
    return d
  }

  async function createBooking(daysAhead: number, hourUTC: number) {
    const startDateTime = futureDate(daysAhead, hourUTC)
    const endDateTime = new Date(startDateTime.getTime() + 60 * 60 * 1000)
    return prisma.booking.create({
      data: {
        businessId: biz.id,
        serviceId: svc.id,
        customerId: cust.id,
        startDateTime,
        endDateTime,
        status: BookingStatus.pending_payment,
        totalPrice: svc.price,
        depositRequired: svc.depositAmount,
        depositPaid: 0,
        remainingBalance: svc.price,
        finalAmount: svc.price,
        paymentStatus: BookingPaymentStatus.unpaid,
      },
    })
  }

  it('consume el paquete: aplica descuento total, flip a redeemed y crea PromotionRedemption; agota y una tercera reserva no obtiene descuento; una compra vencida no aplica', async () => {
    const purchase = await prisma.packagePurchase.create({
      data: {
        id: 'itpc-purchase1',
        businessId: biz.id,
        customerId: cust.id,
        packageProductId: await createPackageProduct(),
        pricePaid: 36000,
        quantity: 2,
        bonusQuantity: 0,
        coversAll: true,
        coveredServiceIds: [],
        source: 'dashboard',
        status: 'active',
      },
    })

    const grant1 = await prisma.promotionGrant.create({
      data: {
        id: 'itpc-grant1',
        businessId: biz.id,
        promotionId: promo.id,
        customerId: cust.id,
        code: 'ITPC-GRANT-1',
        pointsSpent: 0,
        status: 'active',
        refundOnExpiry: false,
        forfeitOnNoShow: false,
        requestId: 'itpc-req-1',
        packagePurchaseId: purchase.id,
      },
    })
    const grant2 = await prisma.promotionGrant.create({
      data: {
        id: 'itpc-grant2',
        businessId: biz.id,
        promotionId: promo.id,
        customerId: cust.id,
        code: 'ITPC-GRANT-2',
        pointsSpent: 0,
        status: 'active',
        refundOnExpiry: false,
        forfeitOnNoShow: false,
        requestId: 'itpc-req-2',
        packagePurchaseId: purchase.id,
      },
    })

    // Grant vencido (compra vencida no debería aplicarse): otro purchase, expiresAt en el pasado.
    const expiredPurchase = await prisma.packagePurchase.create({
      data: {
        id: 'itpc-purchase-expired',
        businessId: biz.id,
        customerId: cust.id,
        packageProductId: purchase.packageProductId,
        pricePaid: 18000,
        quantity: 1,
        bonusQuantity: 0,
        coversAll: true,
        coveredServiceIds: [],
        source: 'dashboard',
        status: 'active',
      },
    })
    await prisma.promotionGrant.create({
      data: {
        id: 'itpc-grant-expired',
        businessId: biz.id,
        promotionId: promo.id,
        customerId: cust.id,
        code: 'ITPC-GRANT-EXPIRED',
        pointsSpent: 0,
        status: 'active',
        expiresAt: new Date('2026-01-01T00:00:00Z'), // en el pasado respecto a FAKE_NOW
        refundOnExpiry: false,
        forfeitOnNoShow: false,
        requestId: 'itpc-req-expired',
        packagePurchaseId: expiredPurchase.id,
      },
    })

    // 1ra reserva: consume el grant que vence primero (el expirado no cuenta porque
    // ya pasó su expiresAt y queda filtrado de la query).
    const booking1 = await createBooking(2, 13)
    const result1 = await prisma.$transaction((tx) =>
      applyPackageInTx(tx, {
        businessId: biz.id, customerId: cust.id, serviceId: svc.id, bookingId: booking1.id,
        totalPrice: svc.price, source: 'dashboard_booking',
      }),
    )
    expect(result1).not.toBeNull()
    expect(result1!.discountAmount).toBe(svc.price)
    expect(result1!.packagePurchaseId).toBe(purchase.id)

    const grant1After = await prisma.promotionGrant.findUnique({ where: { id: grant1.id } })
    // el que consumió pudo ser grant1 o grant2 (ambos expiresAt null, orden no determinista
    // entre ellos); comprobamos que exactamente uno de los dos quedó redeemed.
    const grant2After = await prisma.promotionGrant.findUnique({ where: { id: grant2.id } })
    const redeemedCount = [grant1After, grant2After].filter((g) => g?.status === 'redeemed').length
    expect(redeemedCount).toBe(1)
    const activeCount = [grant1After, grant2After].filter((g) => g?.status === 'active').length
    expect(activeCount).toBe(1)

    const redeemedGrant = grant1After?.status === 'redeemed' ? grant1After : grant2After
    expect(redeemedGrant?.redeemedBookingId).toBe(booking1.id)

    const redemption1 = await prisma.promotionRedemption.findUnique({ where: { bookingId: booking1.id } })
    expect(redemption1).not.toBeNull()
    expect(redemption1!.discountAmount).toBe(svc.price)

    // 2da reserva: consume el 2do grant activo.
    const booking2 = await createBooking(3, 13)
    const result2 = await prisma.$transaction((tx) =>
      applyPackageInTx(tx, {
        businessId: biz.id, customerId: cust.id, serviceId: svc.id, bookingId: booking2.id,
        totalPrice: svc.price, source: 'dashboard_booking',
      }),
    )
    expect(result2).not.toBeNull()
    expect(result2!.packagePurchaseId).toBe(purchase.id)

    const bothAfter = await prisma.promotionGrant.findMany({
      where: { id: { in: [grant1.id, grant2.id] } },
    })
    expect(bothAfter.every((g) => g.status === 'redeemed')).toBe(true)

    // 3ra reserva: sin saldo (paquete agotado), applyPackageInTx debe devolver null.
    const booking3 = await createBooking(4, 13)
    const result3 = await prisma.$transaction((tx) =>
      applyPackageInTx(tx, {
        businessId: biz.id, customerId: cust.id, serviceId: svc.id, bookingId: booking3.id,
        totalPrice: svc.price, source: 'dashboard_booking',
      }),
    )
    expect(result3).toBeNull()

    // Verifica que el grant vencido nunca fue tocado (compra vencida no aplica).
    const expiredGrantAfter = await prisma.promotionGrant.findUnique({ where: { id: 'itpc-grant-expired' } })
    expect(expiredGrantAfter?.status).toBe('active')
  })

  async function createPackageProduct(): Promise<string> {
    const product = await prisma.packageProduct.create({
      data: {
        id: 'itpc-product1',
        businessId: biz.id,
        name: 'Paquete de prueba',
        quantity: 2,
        bonusQuantity: 0,
        price: 36000,
        appliesToAll: true,
        isActive: true,
      },
    })
    return product.id
  }
})
