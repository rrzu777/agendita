import { PrismaClient, BookingStatus, BookingPaymentStatus } from '@prisma/client'
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { requireTestDatabase } from './setup'
import { assignBookingNumber } from '@/lib/bookings/number'

requireTestDatabase()

describe('booking number assignment (integration)', () => {
  let prisma: PrismaClient
  const bizId = 'bn-itb-1'
  const svcId = 'bn-its-1'
  const custId = 'bn-itc-1'

  async function cleanup() {
    await prisma.ledgerEntry.deleteMany()
    await prisma.payment.deleteMany()
    await prisma.booking.deleteMany()
    await prisma.customer.deleteMany({ where: { businessId: bizId } })
    await prisma.service.deleteMany({ where: { businessId: bizId } })
    await prisma.businessUser.deleteMany({ where: { businessId: bizId } })
    await prisma.business.deleteMany({ where: { id: bizId } })
    await prisma.user.deleteMany({ where: { id: 'bn-itu-1' } })
  }

  beforeAll(async () => {
    prisma = new PrismaClient()
    await cleanup()
    await prisma.user.create({ data: { id: 'bn-itu-1', email: 'owner@bn.test', name: 'BN Owner' } })
    await prisma.business.create({
      data: {
        id: bizId,
        name: 'BN Biz',
        slug: 'bn-biz',
        subdomain: 'bnbiz',
        ownerUserId: 'bn-itu-1',
        city: 'Santiago',
        country: 'CL',
        currency: 'CLP',
        timezone: 'America/Santiago',
        bookingWindowDays: 90,
        bookingNumberSeq: 5000,
      },
    })
    await prisma.service.create({
      data: { id: svcId, businessId: bizId, name: 'BN Service', durationMinutes: 60, price: 20000, depositAmount: 10000, pastelColor: '#FFD700' },
    })
    await prisma.customer.create({
      data: { id: custId, businessId: bizId, name: 'BN Customer', phone: '+56911111111' },
    })
  })

  afterAll(async () => {
    await cleanup()
    await prisma.$disconnect()
  })

  beforeEach(async () => {
    await prisma.booking.deleteMany()
    await prisma.business.update({ where: { id: bizId }, data: { bookingNumberSeq: 5000 } })
  })

  function makeBookingData(startDateTime: Date, bookingNumber?: number, createdAt?: Date) {
    const endDateTime = new Date(startDateTime.getTime() + 60 * 60 * 1000)
    return {
      businessId: bizId,
      serviceId: svcId,
      customerId: custId,
      startDateTime,
      endDateTime,
      status: BookingStatus.pending_payment,
      totalPrice: 20000,
      depositRequired: 10000,
      depositPaid: 0,
      remainingBalance: 20000,
      finalAmount: 20000,
      paymentStatus: BookingPaymentStatus.unpaid,
      ...(bookingNumber != null ? { bookingNumber } : {}),
      ...(createdAt ? { createdAt } : {}),
    }
  }

  it('returns a value above the previous seq and persists it', async () => {
    const before = await prisma.business.findUniqueOrThrow({ where: { id: bizId }, select: { bookingNumberSeq: true } })
    const assigned = await prisma.$transaction((tx) => assignBookingNumber(tx, bizId))
    const after = await prisma.business.findUniqueOrThrow({ where: { id: bizId }, select: { bookingNumberSeq: true } })
    expect(assigned).toBeGreaterThan(before.bookingNumberSeq)
    expect(assigned).toBe(after.bookingNumberSeq)
    expect(assigned - before.bookingNumberSeq).toBeGreaterThanOrEqual(2)
    expect(assigned - before.bookingNumberSeq).toBeLessThanOrEqual(9)
  })

  it('two sequential assignments strictly increase', async () => {
    const a = await prisma.$transaction((tx) => assignBookingNumber(tx, bizId))
    const b = await prisma.$transaction((tx) => assignBookingNumber(tx, bizId))
    expect(b).toBeGreaterThan(a)
  })

  it('concurrent assignments produce distinct numbers (no collision)', async () => {
    const N = 20
    const results = await Promise.all(
      Array.from({ length: N }, () => prisma.$transaction((tx) => assignBookingNumber(tx, bizId))),
    )
    expect(new Set(results).size).toBe(N)
  })

  it('backfill assigns distinct, monotonic numbers per business', async () => {
    // Insert pre-existing bookings with NULL bookingNumber, controlled createdAt order.
    const ids: string[] = []
    for (let i = 0; i < 6; i++) {
      const start = new Date('2026-08-01T12:00:00Z')
      start.setUTCDate(start.getUTCDate() + i)
      const created = new Date('2026-07-01T00:00:00Z')
      created.setUTCMinutes(created.getUTCMinutes() + i) // strictly increasing createdAt
      const bk = await prisma.booking.create({ data: makeBookingData(start, undefined, created) })
      ids.push(bk.id)
    }
    // Known base for deterministic disjoint-range assertions.
    await prisma.business.update({ where: { id: bizId }, data: { bookingNumberSeq: 5000 } })

    // Core backfill statements from the migration.
    await prisma.$executeRawUnsafe(`
      WITH seq AS (
        SELECT b.id, b."businessId",
               row_number() OVER (PARTITION BY b."businessId" ORDER BY b."createdAt", b.id) AS rn
        FROM "Booking" b
      )
      UPDATE "Booking" bk
      SET "bookingNumber" = biz."bookingNumberSeq" + (seq.rn - 1) * 7 + floor(random() * 6)::int
      FROM seq
      JOIN "Business" biz ON biz.id = seq."businessId"
      WHERE bk.id = seq.id;
    `)
    await prisma.$executeRawUnsafe(`
      UPDATE "Business" biz
      SET "bookingNumberSeq" = m.maxnum
      FROM (SELECT "businessId", max("bookingNumber") AS maxnum FROM "Booking" GROUP BY "businessId") m
      WHERE biz.id = m."businessId";
    `)

    const rows = await prisma.booking.findMany({
      where: { businessId: bizId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { bookingNumber: true },
    })
    const numbers = rows.map((r) => r.bookingNumber!)
    expect(numbers.every((n) => n != null)).toBe(true)
    expect(new Set(numbers).size).toBe(numbers.length) // all distinct
    for (let i = 1; i < numbers.length; i++) {
      expect(numbers[i]).toBeGreaterThan(numbers[i - 1]) // monotonic by (createdAt, id)
    }
    const biz = await prisma.business.findUniqueOrThrow({ where: { id: bizId }, select: { bookingNumberSeq: true } })
    expect(biz.bookingNumberSeq).toBe(Math.max(...numbers))
  })

  it('rejects a duplicate (businessId, bookingNumber)', async () => {
    await prisma.booking.create({ data: makeBookingData(new Date('2026-09-01T12:00:00Z'), 7777) })
    await expect(
      prisma.booking.create({ data: makeBookingData(new Date('2026-09-05T12:00:00Z'), 7777) }),
    ).rejects.toThrow()
  })
})
