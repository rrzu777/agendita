import { BookingPaymentStatus, BookingStatus, Prisma, PrismaClient } from '@prisma/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { requireTestDatabase } from './setup'

requireTestDatabase()

const OWNER_ID = 'push-schema-owner'
const USER_ID = 'push-schema-user'
const BUSINESS_ID = 'push-schema-business'
const CUSTOMER_ID = 'push-schema-customer'
const SERVICE_ID = 'push-schema-service'
const BOOKING_ONE_ID = 'push-schema-booking-1'
const BOOKING_TWO_ID = 'push-schema-booking-2'

describe('push authorization persistence', () => {
  const prisma = new PrismaClient()

  async function cleanup() {
    await prisma.business.deleteMany({ where: { id: BUSINESS_ID } })
    await prisma.user.deleteMany({ where: { id: { in: [OWNER_ID, USER_ID] } } })
  }

  beforeAll(async () => {
    await cleanup()
    await prisma.user.createMany({
      data: [
        { id: OWNER_ID, email: 'push-schema-owner@test.test' },
        { id: USER_ID, email: 'push-schema-user@test.test' },
      ],
    })
    await prisma.business.create({
      data: {
        id: BUSINESS_ID,
        name: 'Push Schema Test',
        slug: BUSINESS_ID,
        subdomain: 'pushschematest',
        ownerUserId: OWNER_ID,
        city: 'Santiago',
      },
    })
    await prisma.customer.create({
      data: {
        id: CUSTOMER_ID,
        businessId: BUSINESS_ID,
        userId: USER_ID,
        name: 'Push Test',
        phone: '56900000001',
      },
    })
    await prisma.service.create({
      data: {
        id: SERVICE_ID,
        businessId: BUSINESS_ID,
        name: 'Push Test',
        durationMinutes: 60,
        price: 10_000,
        depositAmount: 2_000,
        pastelColor: '#abcdef',
      },
    })
    for (const [id, day] of [[BOOKING_ONE_ID, 12], [BOOKING_TWO_ID, 13]] as const) {
      const startDateTime = new Date(`2026-08-${day}T15:00:00.000Z`)
      await prisma.booking.create({
        data: {
          id,
          businessId: BUSINESS_ID,
          customerId: CUSTOMER_ID,
          serviceId: SERVICE_ID,
          startDateTime,
          endDateTime: new Date(startDateTime.getTime() + 60 * 60_000),
          status: BookingStatus.confirmed,
          totalPrice: 10_000,
          depositRequired: 2_000,
          depositPaid: 2_000,
          remainingBalance: 8_000,
          finalAmount: 10_000,
          paymentStatus: BookingPaymentStatus.deposit_paid,
        },
      })
    }
  })

  afterAll(async () => {
    await cleanup()
    await prisma.$disconnect()
  })

  it('enforces explicit user ownership and fingerprint uniqueness', async () => {
    await prisma.pushSubscription.create({
      data: {
        id: 'push-schema-subscription',
        businessId: BUSINESS_ID,
        customerId: CUSTOMER_ID,
        authorizedUserId: USER_ID,
        endpointHash: 'a'.repeat(64),
        subscriptionFingerprint: 'b'.repeat(64),
        subscriptionEncrypted: 'ciphertext',
      },
    })

    const duplicate = await prisma.pushSubscription.create({
      data: {
        businessId: BUSINESS_ID,
        customerId: CUSTOMER_ID,
        endpointHash: 'c'.repeat(64),
        subscriptionFingerprint: 'b'.repeat(64),
        subscriptionEncrypted: 'other-ciphertext',
      },
    }).catch((error: unknown) => error)
    expect(duplicate).toBeInstanceOf(Prisma.PrismaClientKnownRequestError)
    expect((duplicate as Prisma.PrismaClientKnownRequestError).code).toBe('P2002')

    await expect(prisma.pushSubscription.create({
      data: {
        businessId: BUSINESS_ID,
        customerId: CUSTOMER_ID,
        authorizedUserId: 'missing-user',
        endpointHash: 'd'.repeat(64),
        subscriptionFingerprint: 'e'.repeat(64),
        subscriptionEncrypted: 'ciphertext',
      },
    })).rejects.toMatchObject({ code: 'P2003' })
  })

  it('associates a guest capability with exactly one booking', async () => {
    const subscription = await prisma.pushSubscription.create({
      data: {
        businessId: BUSINESS_ID,
        customerId: CUSTOMER_ID,
        endpointHash: 'f'.repeat(64),
        subscriptionFingerprint: '0'.repeat(64),
        subscriptionEncrypted: 'guest-ciphertext',
        bookingEntitlements: { create: { bookingId: BOOKING_ONE_ID } },
      },
      include: { bookingEntitlements: true },
    })

    expect(subscription.authorizedUserId).toBeNull()
    expect(subscription.bookingEntitlements).toEqual([
      expect.objectContaining({ bookingId: BOOKING_ONE_ID }),
    ])
    expect(await prisma.pushSubscriptionBooking.count({
      where: { subscriptionId: subscription.id, bookingId: BOOKING_TWO_ID },
    })).toBe(0)
  })
})
