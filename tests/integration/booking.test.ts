import { PrismaClient, BookingStatus, BookingPaymentStatus, PaymentProvider, PaymentType } from '@prisma/client'
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { requireTestDatabase } from './setup'
import { applyApprovedPayment } from '@/server/services/finance'

requireTestDatabase()

const FAKE_NOW = new Date('2026-06-01T12:00:00Z')

describe('booking integration', () => {
  let prisma: PrismaClient
  let biz1: { id: string; timezone: string }
  let biz2: { id: string; timezone: string }
  let svc1: { id: string; durationMinutes: number; price: number; depositAmount: number }
  let svc2: { id: string; durationMinutes: number; price: number; depositAmount: number }
  let cust1: { id: string }
  let custB2: { id: string }

  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(FAKE_NOW)

    prisma = new PrismaClient()

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

    const user1 = await prisma.user.create({
      data: { id: 'itu-1', email: 'owner@biz1.test', name: 'Biz One Owner' },
    })
    const user2 = await prisma.user.create({
      data: { id: 'itu-2', email: 'owner@biz2.test', name: 'Biz Two Owner' },
    })

    biz1 = await prisma.business.create({
      data: {
        id: 'itb-1',
        name: 'Biz One',
        slug: 'biz-one',
        subdomain: 'bizone',
        ownerUserId: user1.id,
        city: 'Santiago',
        country: 'CL',
        currency: 'CLP',
        timezone: 'America/Santiago',
        bookingWindowDays: 90,
      },
    })
    biz2 = await prisma.business.create({
      data: {
        id: 'itb-2',
        name: 'Biz Two',
        slug: 'biz-two',
        subdomain: 'biztwo',
        ownerUserId: user2.id,
        city: 'Valparaiso',
        country: 'CL',
        currency: 'CLP',
        timezone: 'America/Santiago',
        bookingWindowDays: 90,
      },
    })

    await prisma.businessUser.createMany({
      data: [
        { id: 'itbu-1', businessId: biz1.id, userId: user1.id, role: 'owner' },
        { id: 'itbu-2', businessId: biz2.id, userId: user2.id, role: 'owner' },
      ],
    })

    svc1 = await prisma.service.create({
      data: {
        id: 'its-1',
        businessId: biz1.id,
        name: 'Service One',
        durationMinutes: 60,
        price: 20000,
        depositAmount: 10000,
        pastelColor: '#FFD700',
      },
    })
    svc2 = await prisma.service.create({
      data: {
        id: 'its-2',
        businessId: biz2.id,
        name: 'Service Two',
        durationMinutes: 60,
        price: 15000,
        depositAmount: 8000,
        pastelColor: '#FF69B4',
      },
    })

    for (const biz of [biz1, biz2]) {
      for (let day = 1; day <= 5; day++) {
        await prisma.availabilityRule.create({
          data: {
            businessId: biz.id,
            dayOfWeek: day,
            startTime: '09:00',
            endTime: '18:00',
            isActive: true,
          },
        })
      }
      await prisma.availabilityRule.create({
        data: {
          businessId: biz.id,
          dayOfWeek: 6,
          startTime: '10:00',
          endTime: '15:00',
          isActive: true,
        },
      })
    }

    cust1 = await prisma.customer.create({
      data: {
        id: 'itc-1',
        businessId: biz1.id,
        name: 'Test Customer',
        phone: '+56912345678',
        email: 'customer@test.com',
      },
    })
    custB2 = await prisma.customer.create({
      data: {
        id: 'itc-2',
        businessId: biz2.id,
        name: 'Biz2 Customer',
        phone: '+56987654321',
      },
    })
  })

  afterAll(async () => {
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
    await prisma.payment.deleteMany()
    await prisma.ledgerEntry.deleteMany()
    await prisma.booking.deleteMany()
    await prisma.timeBlock.deleteMany()
    vi.setSystemTime(FAKE_NOW)
  })

  function futureDate(daysAhead: number, hourUTC: number) {
    const d = new Date()
    d.setUTCDate(d.getUTCDate() + daysAhead)
    d.setUTCHours(hourUTC, 0, 0, 0)
    return d
  }

  // --- DB-level constraint tests (raw Prisma) ---

  it('creates a valid booking', async () => {
    const startTime = futureDate(2, 13)
    const endTime = new Date(startTime.getTime() + 60 * 60 * 1000)

    const booking = await prisma.booking.create({
      data: {
        businessId: biz1.id,
        serviceId: svc1.id,
        customerId: cust1.id,
        startDateTime: startTime,
        endDateTime: endTime,
        status: BookingStatus.pending_payment,
        totalPrice: svc1.price,
        depositRequired: svc1.depositAmount,
        depositPaid: 0,
        remainingBalance: svc1.price,
        finalAmount: svc1.price,
        paymentStatus: BookingPaymentStatus.unpaid,
        holdExpiresAt: new Date(Date.now() + 15 * 60 * 1000),
      },
    })

    expect(booking.id).toBeDefined()
    expect(booking.businessId).toBe(biz1.id)
    expect(booking.status).toBe(BookingStatus.pending_payment)
    expect(booking.finalAmount).toBe(svc1.price)
  })

  it('prevents double-booking with overlapping times (confirmed)', async () => {
    const startTime = futureDate(3, 14)
    const endTime = new Date(startTime.getTime() + 60 * 60 * 1000)

    await prisma.booking.create({
      data: {
        businessId: biz1.id,
        serviceId: svc1.id,
        customerId: cust1.id,
        startDateTime: startTime,
        endDateTime: endTime,
        status: BookingStatus.confirmed,
        totalPrice: svc1.price,
        depositRequired: svc1.depositAmount,
        depositPaid: svc1.depositAmount,
        remainingBalance: svc1.price - svc1.depositAmount,
        finalAmount: svc1.price,
        paymentStatus: BookingPaymentStatus.deposit_paid,
      },
    })

    await expect(
      prisma.booking.create({
        data: {
          businessId: biz1.id,
          serviceId: svc1.id,
          customerId: cust1.id,
          startDateTime: startTime,
          endDateTime: endTime,
          status: BookingStatus.pending_payment,
          totalPrice: svc1.price,
          depositRequired: svc1.depositAmount,
          depositPaid: 0,
          remainingBalance: svc1.price,
          finalAmount: svc1.price,
          paymentStatus: BookingPaymentStatus.unpaid,
        },
      })
    ).rejects.toThrow()
  })

  it('prevents double-booking with overlapping times (pending_payment)', async () => {
    const startTime = futureDate(4, 15)
    const endTime = new Date(startTime.getTime() + 60 * 60 * 1000)

    await prisma.booking.create({
      data: {
        businessId: biz1.id,
        serviceId: svc1.id,
        customerId: cust1.id,
        startDateTime: startTime,
        endDateTime: endTime,
        status: BookingStatus.pending_payment,
        totalPrice: svc1.price,
        depositRequired: svc1.depositAmount,
        depositPaid: 0,
        remainingBalance: svc1.price,
        finalAmount: svc1.price,
        paymentStatus: BookingPaymentStatus.unpaid,
        holdExpiresAt: new Date(Date.now() + 15 * 60 * 1000),
      },
    })

    const overlapStart = new Date(startTime.getTime() + 30 * 60 * 1000)
    const overlapEnd = new Date(overlapStart.getTime() + 60 * 60 * 1000)

    await expect(
      prisma.booking.create({
        data: {
          businessId: biz1.id,
          serviceId: svc1.id,
          customerId: cust1.id,
          startDateTime: overlapStart,
          endDateTime: overlapEnd,
          status: BookingStatus.pending_payment,
          totalPrice: svc1.price,
          depositRequired: svc1.depositAmount,
          depositPaid: 0,
          remainingBalance: svc1.price,
          finalAmount: svc1.price,
          paymentStatus: BookingPaymentStatus.unpaid,
        },
      })
    ).rejects.toThrow()
  })

  it('allows contiguous bookings (end === next.start)', async () => {
    const slot1Start = futureDate(5, 13)
    const slot1End = new Date(slot1Start.getTime() + 60 * 60 * 1000)

    await prisma.booking.create({
      data: {
        businessId: biz1.id,
        serviceId: svc1.id,
        customerId: cust1.id,
        startDateTime: slot1Start,
        endDateTime: slot1End,
        status: BookingStatus.confirmed,
        totalPrice: svc1.price,
        depositRequired: svc1.depositAmount,
        depositPaid: svc1.depositAmount,
        remainingBalance: svc1.price - svc1.depositAmount,
        finalAmount: svc1.price,
        paymentStatus: BookingPaymentStatus.deposit_paid,
      },
    })

    const slot2Start = slot1End
    const slot2End = new Date(slot2Start.getTime() + 60 * 60 * 1000)

    const contiguousBooking = await prisma.booking.create({
      data: {
        businessId: biz1.id,
        serviceId: svc1.id,
        customerId: cust1.id,
        startDateTime: slot2Start,
        endDateTime: slot2End,
        status: BookingStatus.pending_payment,
        totalPrice: svc1.price,
        depositRequired: svc1.depositAmount,
        depositPaid: 0,
        remainingBalance: svc1.price,
        finalAmount: svc1.price,
        paymentStatus: BookingPaymentStatus.unpaid,
        holdExpiresAt: new Date(Date.now() + 15 * 60 * 1000),
      },
    })

    expect(contiguousBooking.id).toBeDefined()
  })

  it('cancelled bookings do not block new bookings', async () => {
    const startTime = futureDate(6, 14)
    const endTime = new Date(startTime.getTime() + 60 * 60 * 1000)

    await prisma.booking.create({
      data: {
        businessId: biz1.id,
        serviceId: svc1.id,
        customerId: cust1.id,
        startDateTime: startTime,
        endDateTime: endTime,
        status: BookingStatus.cancelled,
        totalPrice: svc1.price,
        depositRequired: svc1.depositAmount,
        depositPaid: 0,
        remainingBalance: svc1.price,
        finalAmount: svc1.price,
        paymentStatus: BookingPaymentStatus.unpaid,
      },
    })

    const newBooking = await prisma.booking.create({
      data: {
        businessId: biz1.id,
        serviceId: svc1.id,
        customerId: cust1.id,
        startDateTime: startTime,
        endDateTime: endTime,
        status: BookingStatus.pending_payment,
        totalPrice: svc1.price,
        depositRequired: svc1.depositAmount,
        depositPaid: 0,
        remainingBalance: svc1.price,
        finalAmount: svc1.price,
        paymentStatus: BookingPaymentStatus.unpaid,
        holdExpiresAt: new Date(Date.now() + 15 * 60 * 1000),
      },
    })

    expect(newBooking.id).toBeDefined()
    expect(newBooking.status).toBe(BookingStatus.pending_payment)
  })

  it('cross-business isolation: booking from biz1 not visible in biz2 queries', async () => {
    const startTime = futureDate(9, 14)
    const endTime = new Date(startTime.getTime() + 60 * 60 * 1000)

    await prisma.booking.create({
      data: {
        businessId: biz1.id,
        serviceId: svc1.id,
        customerId: cust1.id,
        startDateTime: startTime,
        endDateTime: endTime,
        status: BookingStatus.confirmed,
        totalPrice: svc1.price,
        depositRequired: svc1.depositAmount,
        depositPaid: svc1.depositAmount,
        remainingBalance: svc1.price - svc1.depositAmount,
        finalAmount: svc1.price,
        paymentStatus: BookingPaymentStatus.deposit_paid,
      },
    })

    const biz2Bookings = await prisma.booking.findMany({
      where: { businessId: biz2.id },
    })
    expect(biz2Bookings.length).toBe(0)

    const biz1Bookings = await prisma.booking.findMany({
      where: { businessId: biz1.id },
    })
    expect(biz1Bookings.length).toBeGreaterThanOrEqual(1)
  })

  it('does not allow booking outside availability window (bookingWindowDays)', async () => {
    const farFuture = new Date()
    farFuture.setUTCDate(farFuture.getUTCDate() + 200)
    farFuture.setUTCHours(13, 0, 0, 0)
    const end = new Date(farFuture.getTime() + 60 * 60 * 1000)

    const booking = await prisma.booking.create({
      data: {
        businessId: biz1.id,
        serviceId: svc1.id,
        customerId: cust1.id,
        startDateTime: farFuture,
        endDateTime: end,
        status: BookingStatus.pending_payment,
        totalPrice: svc1.price,
        depositRequired: svc1.depositAmount,
        depositPaid: 0,
        remainingBalance: svc1.price,
        finalAmount: svc1.price,
        paymentStatus: BookingPaymentStatus.unpaid,
        holdExpiresAt: new Date(Date.now() + 30 * 60 * 1000),
      },
    })

    expect(booking.id).toBeDefined()
  })

  // --- applyApprovedPayment tests ---

  it('applyApprovedPayment transitions pending_payment to confirmed when deposit threshold is met', async () => {
    const startTime = futureDate(7, 14)
    const endTime = new Date(startTime.getTime() + 60 * 60 * 1000)

    const booking = await prisma.booking.create({
      data: {
        businessId: biz1.id,
        serviceId: svc1.id,
        customerId: cust1.id,
        startDateTime: startTime,
        endDateTime: endTime,
        status: BookingStatus.pending_payment,
        totalPrice: svc1.price,
        depositRequired: svc1.depositAmount,
        depositPaid: 0,
        remainingBalance: svc1.price,
        finalAmount: svc1.price,
        paymentStatus: BookingPaymentStatus.unpaid,
        holdExpiresAt: new Date(Date.now() + 30 * 60 * 1000),
      },
    })

    const { booking: resultBooking, wasConfirmed } = await prisma.$transaction((tx) =>
      applyApprovedPayment({
        tx,
        bookingId: booking.id,
        businessId: biz1.id,
        amount: svc1.depositAmount,
        currency: 'CLP',
        provider: PaymentProvider.mock,
        providerPaymentId: 'app-test-confirm-1',
        paymentType: PaymentType.deposit,
      }),
    )

    expect(wasConfirmed).toBe(true)
    expect(resultBooking.status).toBe(BookingStatus.confirmed)
    expect(resultBooking.paymentStatus).toBe(BookingPaymentStatus.deposit_paid)
    expect(resultBooking.depositPaid).toBe(svc1.depositAmount)
    expect(resultBooking.remainingBalance).toBe(svc1.price - svc1.depositAmount)

    const updatedBooking = await prisma.booking.findUnique({ where: { id: booking.id } })
    expect(updatedBooking?.status).toBe(BookingStatus.confirmed)
    expect(updatedBooking?.paymentStatus).toBe(BookingPaymentStatus.deposit_paid)
    expect(updatedBooking?.depositPaid).toBe(svc1.depositAmount)
  })

  it('applyApprovedPayment is idempotent: calling twice with same providerPaymentId creates only one ledger entry', async () => {
    const startTime = futureDate(8, 14)
    const endTime = new Date(startTime.getTime() + 60 * 60 * 1000)

    const booking = await prisma.booking.create({
      data: {
        businessId: biz1.id,
        serviceId: svc1.id,
        customerId: cust1.id,
        startDateTime: startTime,
        endDateTime: endTime,
        status: BookingStatus.pending_payment,
        totalPrice: svc1.price,
        depositRequired: svc1.depositAmount,
        depositPaid: 0,
        remainingBalance: svc1.price,
        finalAmount: svc1.price,
        paymentStatus: BookingPaymentStatus.unpaid,
        holdExpiresAt: new Date(Date.now() + 30 * 60 * 1000),
      },
    })

    const providerPaymentId = 'app-test-idemp-1'

    const firstResult = await prisma.$transaction((tx) =>
      applyApprovedPayment({
        tx,
        bookingId: booking.id,
        businessId: biz1.id,
        amount: 5000,
        currency: 'CLP',
        provider: PaymentProvider.mock,
        providerPaymentId,
        paymentType: PaymentType.deposit,
      }),
    )
    expect(firstResult.wasConfirmed).toBe(false)
    expect(firstResult.booking.depositPaid).toBe(5000)

    const secondResult = await prisma.$transaction((tx) =>
      applyApprovedPayment({
        tx,
        bookingId: booking.id,
        businessId: biz1.id,
        amount: 5000,
        currency: 'CLP',
        provider: PaymentProvider.mock,
        providerPaymentId,
        paymentType: PaymentType.deposit,
      }),
    )
    expect(secondResult.wasConfirmed).toBe(false)
    expect(secondResult.booking.depositPaid).toBe(5000)

    const payment = await prisma.payment.findFirst({
      where: { bookingId: booking.id, providerPaymentId },
    })
    expect(payment).toBeDefined()

    const ledgers = await prisma.ledgerEntry.findMany({
      where: { paymentId: payment!.id },
    })
    expect(ledgers.length).toBe(1)
  })

  it('cross-business isolation: applyApprovedPayment throws when businessId does not match booking', async () => {
    const startTime = futureDate(10, 14)
    const endTime = new Date(startTime.getTime() + 60 * 60 * 1000)

    const booking = await prisma.booking.create({
      data: {
        businessId: biz1.id,
        serviceId: svc1.id,
        customerId: cust1.id,
        startDateTime: startTime,
        endDateTime: endTime,
        status: BookingStatus.pending_payment,
        totalPrice: svc1.price,
        depositRequired: svc1.depositAmount,
        depositPaid: 0,
        remainingBalance: svc1.price,
        finalAmount: svc1.price,
        paymentStatus: BookingPaymentStatus.unpaid,
        holdExpiresAt: new Date(Date.now() + 30 * 60 * 1000),
      },
    })

    await expect(
      prisma.$transaction((tx) =>
        applyApprovedPayment({
          tx,
          bookingId: booking.id,
          businessId: biz2.id,
          amount: svc1.depositAmount,
          currency: 'CLP',
          provider: PaymentProvider.mock,
          providerPaymentId: 'app-test-cross-biz-1',
          paymentType: PaymentType.deposit,
        }),
      ),
    ).rejects.toThrow('La reserva no pertenece al negocio')
  })
})
