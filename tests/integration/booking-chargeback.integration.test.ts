import { PrismaClient, BookingStatus, BookingPaymentStatus, PaymentType } from '@prisma/client'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { requireTestDatabase } from './setup'
import { reverseBookingPaymentInTx } from '@/lib/bookings/reverse-payment'
import { applyApprovedPayment } from '@/server/services/finance'
import { creditVisitPoints } from '@/lib/loyalty/credit'

requireTestDatabase()

const BIZ = 'bkcb-biz-1'
const USER = 'bkcb-user-1'

// E2E del núcleo de chargeback de reserva (spec FU-B4b-3 §Testing): reserva
// COMPLETED y pagada al 100% con puntos acreditados → chargeback → montos
// restaurados + marcador + clawback + asiento; luego recobro manual con
// allowCompleted → el recalc limpia el marcador.
describe('booking chargeback e2e (núcleo + recobro)', () => {
  let prisma: PrismaClient
  let bookingId: string
  let paymentId: string
  let customerId: string

  beforeAll(async () => {
    prisma = new PrismaClient()
    await prisma.user.create({ data: { id: USER, email: 'bkcb@t.test', name: 'Owner CB' } })
    await prisma.business.create({ data: {
      id: BIZ, name: 'CB Biz', slug: 'cb-biz', subdomain: 'cbbiz', ownerUserId: USER,
      city: 'Santiago', country: 'CL', currency: 'CLP', timezone: 'America/Santiago', bookingWindowDays: 90,
    } })
    await prisma.loyaltyConfig.create({ data: {
      businessId: BIZ, isActive: true, programName: 'Puntos CB',
      pointsPerVisit: 10, clawbackAutoRewardOnRefund: true,
    } })
    const customer = await prisma.customer.create({ data: {
      businessId: BIZ, name: 'Cli CB', phone: '+56900000031',
    } })
    customerId = customer.id
    const service = await prisma.service.create({ data: {
      businessId: BIZ, name: 'Sesión CB', durationMinutes: 60, price: 10000,
      depositAmount: 5000, pastelColor: '#FFD700',
    } })
    const booking = await prisma.booking.create({ data: {
      businessId: BIZ, serviceId: service.id, customerId,
      startDateTime: new Date('2026-07-10T15:00:00Z'), endDateTime: new Date('2026-07-10T16:00:00Z'),
      status: BookingStatus.completed, totalPrice: 10000, depositRequired: 5000,
      depositPaid: 10000, remainingBalance: 0, finalAmount: 10000,
      paymentStatus: BookingPaymentStatus.fully_paid,
    } })
    bookingId = booking.id
    const payment = await prisma.payment.create({ data: {
      businessId: BIZ, bookingId, customerId, provider: 'mercado_pago',
      providerPaymentId: 'mp-cb-001', amount: 10000, currency: 'CLP',
      status: 'approved', paymentType: PaymentType.full_payment, paidAt: new Date('2026-07-10T14:00:00Z'),
    } })
    paymentId = payment.id
    // Earn real de puntos por la visita (mismo camino que updateBookingStatus).
    await prisma.$transaction((tx) => creditVisitPoints(tx, {
      businessId: BIZ, customerId, finalAmount: 10000, bookingId,
      config: { isActive: true, pointsPerVisit: 10, spendPerPoint: null, minSpendToEarn: null },
    }))
  })

  afterAll(async () => {
    await prisma.ledgerEntry.deleteMany({ where: { businessId: BIZ } })
    await prisma.loyaltyLedger.deleteMany({ where: { businessId: BIZ } })
    await prisma.payment.deleteMany({ where: { businessId: BIZ } })
    await prisma.booking.deleteMany({ where: { businessId: BIZ } })
    await prisma.service.deleteMany({ where: { businessId: BIZ } })
    await prisma.customer.deleteMany({ where: { businessId: BIZ } })
    await prisma.loyaltyConfig.deleteMany({ where: { businessId: BIZ } })
    await prisma.business.deleteMany({ where: { id: BIZ } })
    await prisma.user.deleteMany({ where: { id: USER } })
    await prisma.$disconnect()
  })

  it('chargeback: flip + montos restaurados + marcador + clawback + asiento; segunda corrida no-op; recobro limpia el marcador', async () => {
    const now = new Date('2026-07-16T12:00:00Z')
    const res = await prisma.$transaction((tx) => reverseBookingPaymentInTx(tx, {
      paymentId, bookingId, businessId: BIZ, customerId,
      amount: 10000, currency: 'CLP', mode: 'chargeback', now,
    }))
    expect(res.reversed).toBe(true)

    const payment = await prisma.payment.findUnique({ where: { id: paymentId } })
    expect(payment!.status).toBe('refunded')

    const booking = await prisma.booking.findUnique({ where: { id: bookingId } })
    expect(booking!.paymentStatus).toBe(BookingPaymentStatus.refunded) // marcador
    expect(booking!.status).toBe(BookingStatus.completed) // status INTACTO (la dueña decide)
    expect(booking!.depositPaid).toBe(0) // montos restaurados
    expect(booking!.remainingBalance).toBe(10000)

    const refundEntry = await prisma.ledgerEntry.findFirst({
      where: { businessId: BIZ, bookingId, type: 'refund_issued', direction: 'expense' },
    })
    expect(refundEntry).not.toBeNull()
    expect(refundEntry!.paymentId).toBeNull()
    expect(refundEntry!.amount).toBe(10000)

    // Clawback de puntos: visit_reversal con puntos negativos (neto 0).
    const ledger = await prisma.loyaltyLedger.findMany({ where: { bookingId } })
    const reversal = ledger.find((l) => l.reason === 'visit_reversal')
    expect(reversal).not.toBeNull()
    expect(reversal!.points).toBeLessThan(0)
    expect(ledger.reduce((s, l) => s + l.points, 0)).toBe(0)

    // Segunda corrida (redelivery): no-op sin duplicados.
    const res2 = await prisma.$transaction((tx) => reverseBookingPaymentInTx(tx, {
      paymentId, bookingId, businessId: BIZ, customerId,
      amount: 10000, currency: 'CLP', mode: 'chargeback', now,
    }))
    expect(res2.reversed).toBe(false)
    const refundEntries = await prisma.ledgerEntry.count({
      where: { businessId: BIZ, bookingId, type: 'refund_issued' },
    })
    expect(refundEntries).toBe(1)
    const reversals = await prisma.loyaltyLedger.count({ where: { bookingId, reason: 'visit_reversal' } })
    expect(reversals).toBe(1)

    // Recobro (spec §6): pago manual sobre la reserva completed con saldo.
    await prisma.$transaction(async (tx) => {
      await applyApprovedPayment({
        tx, bookingId, businessId: BIZ, amount: 10000, currency: 'CLP',
        provider: 'manual', providerPaymentId: null,
        paymentType: PaymentType.full_payment, allowCompleted: true,
      })
    })
    const recovered = await prisma.booking.findUnique({ where: { id: bookingId } })
    expect(recovered!.paymentStatus).toBe(BookingPaymentStatus.fully_paid) // recalc limpió el marcador
    expect(recovered!.remainingBalance).toBe(0)
    expect(recovered!.depositPaid).toBe(10000)
    expect(recovered!.status).toBe(BookingStatus.completed)
  })
})
