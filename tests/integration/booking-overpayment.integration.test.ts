import { PrismaClient, BookingStatus, BookingPaymentStatus, PaymentType } from '@prisma/client'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { requireTestDatabase } from './setup'
import { applyApprovedPayment } from '@/server/services/finance'

requireTestDatabase()

const BIZ = 'bkop-biz-1'
const USER = 'bkop-user-1'

// Reserva saldada + pago aprobado NUEVO que llega tarde (la clienta pagó por otra
// vía y MP aprobó después, o dos intentos que terminaron aprobados los dos). La
// plata está cobrada de verdad: tiene que quedar asentada, pero NO como facturación.
describe('pago que entra sobre una reserva ya saldada', () => {
  let prisma: PrismaClient
  let bookingId: string
  let customerId: string

  beforeAll(async () => {
    prisma = new PrismaClient()
    await prisma.user.create({ data: { id: USER, email: 'bkop@t.test', name: 'Owner OP' } })
    await prisma.business.create({ data: {
      id: BIZ, name: 'OP Biz', slug: 'op-biz', subdomain: 'opbiz', ownerUserId: USER,
      city: 'Santiago', country: 'CL', currency: 'CLP', timezone: 'America/Santiago', bookingWindowDays: 90,
    } })
    const customer = await prisma.customer.create({ data: {
      businessId: BIZ, name: 'Cli OP', phone: '+56900000041',
    } })
    customerId = customer.id
    const service = await prisma.service.create({ data: {
      businessId: BIZ, name: 'Sesión OP', durationMinutes: 60, price: 10000,
      depositAmount: 5000, pastelColor: '#FFD700',
    } })
    const booking = await prisma.booking.create({ data: {
      businessId: BIZ, serviceId: service.id, customerId,
      startDateTime: new Date('2026-08-10T15:00:00Z'), endDateTime: new Date('2026-08-10T16:00:00Z'),
      status: BookingStatus.pending_payment, totalPrice: 10000, depositRequired: 5000,
      depositPaid: 0, remainingBalance: 10000, finalAmount: 10000,
      paymentStatus: BookingPaymentStatus.unpaid,
    } })
    bookingId = booking.id
  })

  afterAll(async () => {
    await prisma.ledgerEntry.deleteMany({ where: { businessId: BIZ } })
    await prisma.payment.deleteMany({ where: { businessId: BIZ } })
    await prisma.booking.deleteMany({ where: { businessId: BIZ } })
    await prisma.service.deleteMany({ where: { businessId: BIZ } })
    await prisma.customer.deleteMany({ where: { businessId: BIZ } })
    await prisma.business.deleteMany({ where: { id: BIZ } })
    await prisma.user.deleteMany({ where: { id: USER } })
    await prisma.$disconnect()
  })

  it('lo asienta como overpayment, no lo cuenta como ingreso y no toca el saldo', async () => {
    // 1. Pago normal que salda la reserva.
    const first = await prisma.$transaction((tx) => applyApprovedPayment({
      tx, bookingId, businessId: BIZ, amount: 10000, currency: 'CLP',
      provider: 'manual', providerPaymentId: null, paymentType: PaymentType.full_payment,
    }))
    expect(first.wasConfirmed).toBe(true)
    expect(first.wasUnexpected).toBe(false)
    expect(first.booking.remainingBalance).toBe(0)

    // 2. Pago NUEVO de MP que llega tarde sobre la reserva ya saldada.
    const late = await prisma.$transaction((tx) => applyApprovedPayment({
      tx, bookingId, businessId: BIZ, amount: 10000, currency: 'CLP',
      provider: 'mercado_pago', providerPaymentId: 'mp-op-tarde',
      paymentType: PaymentType.full_payment,
    }))
    expect(late.wasUnexpected).toBe(true)

    // El asiento existe, es trazable y dice por qué.
    const entries = await prisma.ledgerEntry.findMany({
      where: { businessId: BIZ, bookingId }, orderBy: { createdAt: 'asc' },
    })
    expect(entries).toHaveLength(2)
    expect(entries[0].type).toBe('full_payment_paid')
    const overpay = entries[1]
    expect(overpay.type).toBe('overpayment')
    expect(overpay.direction).toBe('income')
    expect(overpay.amount).toBe(10000)
    expect(overpay.description).toContain('Pago inesperado')

    // El KPI de ingreso de reserva ve UNA sola venta, no dos. Mismo WHERE que
    // `bookingIncomeWhere` en src/server/actions/ledger.ts — si esa exclusión se
    // cae, este número pasa a 20000.
    const income = await prisma.ledgerEntry.aggregate({
      where: { businessId: BIZ, direction: 'income', packagePurchaseId: null, type: { not: 'overpayment' } },
      _sum: { amount: true },
    })
    expect(income._sum.amount).toBe(10000)

    // La reserva no queda debiendo nada, y `depositPaid` muestra la plata que
    // realmente entró: taparla escondería el cobro de más.
    const booking = await prisma.booking.findUnique({ where: { id: bookingId } })
    expect(booking!.remainingBalance).toBe(0)
    expect(booking!.depositPaid).toBe(20000)
    expect(booking!.paymentStatus).toBe(BookingPaymentStatus.fully_paid)
  })

  it('el redelivery del mismo pago no asienta nada nuevo', async () => {
    const again = await prisma.$transaction((tx) => applyApprovedPayment({
      tx, bookingId, businessId: BIZ, amount: 10000, currency: 'CLP',
      provider: 'mercado_pago', providerPaymentId: 'mp-op-tarde',
      paymentType: PaymentType.full_payment,
    }))
    expect(again.wasUnexpected).toBe(false)
    const count = await prisma.ledgerEntry.count({ where: { businessId: BIZ, bookingId } })
    expect(count).toBe(2)
  })
})
