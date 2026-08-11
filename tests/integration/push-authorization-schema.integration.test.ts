import { BookingPaymentStatus, BookingStatus, Prisma, PrismaClient } from '@prisma/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { requireTestDatabase } from './setup'
import {
  TEST_PUSH_AUTH,
  TEST_VAPID_PRIVATE_KEY,
  TEST_VAPID_PUBLIC_KEY,
} from '../helpers/push-fixtures'

requireTestDatabase()

const OWNER_ID = 'push-schema-owner'
const USER_ID = 'push-schema-user'
const BUSINESS_ID = 'push-schema-business'
const CUSTOMER_ID = 'push-schema-customer'
const CUSTOMER_TWO_ID = 'push-schema-customer-z'
const SERVICE_ID = 'push-schema-service'
const BOOKING_ONE_ID = 'push-schema-booking-1'
const BOOKING_TWO_ID = 'push-schema-booking-2'

describe('push authorization persistence', () => {
  const prisma = new PrismaClient()
  const originalPushEnv = {
    publicKey: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
    privateKey: process.env.VAPID_PRIVATE_KEY,
    subject: process.env.VAPID_SUBJECT,
    encryptionKey: process.env.ENCRYPTION_KEY,
  }

  async function cleanup() {
    await prisma.business.deleteMany({ where: { id: BUSINESS_ID } })
    await prisma.user.deleteMany({ where: { id: { in: [OWNER_ID, USER_ID] } } })
  }

  beforeAll(async () => {
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = TEST_VAPID_PUBLIC_KEY
    process.env.VAPID_PRIVATE_KEY = TEST_VAPID_PRIVATE_KEY
    process.env.VAPID_SUBJECT = 'mailto:integration@agendita.test'
    process.env.ENCRYPTION_KEY = 'push-schema-integration-encryption-key'
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
    await prisma.customer.createMany({
      data: [
        {
          id: CUSTOMER_ID,
          businessId: BUSINESS_ID,
          userId: USER_ID,
          name: 'Push Test One',
          phone: '56900000001',
        },
        {
          id: CUSTOMER_TWO_ID,
          businessId: BUSINESS_ID,
          userId: USER_ID,
          name: 'Push Test Two',
          phone: '56900000002',
        },
      ],
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
    for (const [id, customerId, day] of [
      [BOOKING_ONE_ID, CUSTOMER_ID, 12],
      [BOOKING_TWO_ID, CUSTOMER_TWO_ID, 13],
    ] as const) {
      const startDateTime = new Date(`2026-08-${day}T15:00:00.000Z`)
      await prisma.booking.create({
        data: {
          id,
          businessId: BUSINESS_ID,
          customerId,
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
    if (originalPushEnv.publicKey === undefined) delete process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
    else process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = originalPushEnv.publicKey
    if (originalPushEnv.privateKey === undefined) delete process.env.VAPID_PRIVATE_KEY
    else process.env.VAPID_PRIVATE_KEY = originalPushEnv.privateKey
    if (originalPushEnv.subject === undefined) delete process.env.VAPID_SUBJECT
    else process.env.VAPID_SUBJECT = originalPushEnv.subject
    if (originalPushEnv.encryptionKey === undefined) delete process.env.ENCRYPTION_KEY
    else process.env.ENCRYPTION_KEY = originalPushEnv.encryptionKey
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

  it('rolls back every Customer association when one eligible Customer is at the device cap', async () => {
    const {
      PushDeviceLimitError,
      hasActivePushAssociation,
      hashPushEndpoint,
      storeAuthenticatedPushSubscriptions,
    } = await import('@/lib/push/subscription')
    const incoming = {
      endpoint: 'https://fcm.googleapis.com/fcm/send/account-batch-incoming',
      keys: { p256dh: TEST_VAPID_PUBLIC_KEY, auth: TEST_PUSH_AUTH },
    }
    await prisma.pushSubscription.createMany({
      data: Array.from({ length: 5 }, (_, index) => ({
        businessId: BUSINESS_ID,
        customerId: CUSTOMER_TWO_ID,
        authorizedUserId: USER_ID,
        endpointHash: String(index + 1).repeat(64).slice(0, 64),
        subscriptionFingerprint: String(index + 1).repeat(64).slice(0, 64),
        subscriptionEncrypted: `existing-device-${index + 1}`,
      })),
    })

    await expect(storeAuthenticatedPushSubscriptions({
      userId: USER_ID,
      subscription: incoming,
      now: new Date('2026-08-11T00:00:00.000Z'),
    })).rejects.toBeInstanceOf(PushDeviceLimitError)

    expect(await prisma.pushSubscription.count({
      where: { endpointHash: hashPushEndpoint(incoming.endpoint) },
    })).toBe(0)
    await expect(hasActivePushAssociation({
      endpoint: incoming.endpoint,
      scope: { kind: 'user', userId: USER_ID },
      now: new Date('2026-08-11T00:00:00.000Z'),
    })).resolves.toBe(false)
  })

  it('endpoint-possession cleanup removes mixed guest A+B scopes with no stale active row', async () => {
    const {
      hashPushEndpoint,
      unsubscribePushSubscription,
    } = await import('@/lib/push/subscription')
    const endpoint = 'https://fcm.googleapis.com/fcm/send/mixed-guests-cleanup'
    const endpointHash = hashPushEndpoint(endpoint)
    await prisma.pushSubscription.create({
      data: {
        id: 'push-mixed-guest-a',
        businessId: BUSINESS_ID,
        customerId: CUSTOMER_ID,
        endpointHash,
        subscriptionFingerprint: 'a1'.repeat(32),
        subscriptionEncrypted: 'mixed-guest-a',
        bookingEntitlements: { create: { bookingId: BOOKING_ONE_ID } },
      },
    })
    await prisma.pushSubscription.create({
      data: {
        id: 'push-mixed-guest-b',
        businessId: BUSINESS_ID,
        customerId: CUSTOMER_TWO_ID,
        endpointHash,
        subscriptionFingerprint: 'b2'.repeat(32),
        subscriptionEncrypted: 'mixed-guest-b',
        bookingEntitlements: { create: { bookingId: BOOKING_TWO_ID } },
      },
    })

    await expect(unsubscribePushSubscription({
      endpoint,
      scope: { kind: 'endpoint' },
      now: new Date('2026-08-11T12:00:00.000Z'),
    })).resolves.toBe(2)

    expect(await prisma.pushSubscription.count({ where: { endpointHash, revokedAt: null } })).toBe(0)
    expect(await prisma.pushSubscriptionBooking.count({
      where: { subscription: { endpointHash } },
    })).toBe(0)
  })

  it('endpoint-possession cleanup removes auth+guest scopes from the same row', async () => {
    const {
      hashPushEndpoint,
      unsubscribePushSubscription,
    } = await import('@/lib/push/subscription')
    const endpoint = 'https://fcm.googleapis.com/fcm/send/mixed-auth-guest-cleanup'
    const endpointHash = hashPushEndpoint(endpoint)
    await prisma.pushSubscription.create({
      data: {
        id: 'push-mixed-auth-guest',
        businessId: BUSINESS_ID,
        customerId: CUSTOMER_ID,
        authorizedUserId: USER_ID,
        endpointHash,
        subscriptionFingerprint: 'c3'.repeat(32),
        subscriptionEncrypted: 'mixed-auth-guest',
        bookingEntitlements: { create: { bookingId: BOOKING_ONE_ID } },
      },
    })

    await expect(unsubscribePushSubscription({
      endpoint,
      scope: { kind: 'endpoint' },
      now: new Date('2026-08-11T12:00:00.000Z'),
    })).resolves.toBe(1)

    const stored = await prisma.pushSubscription.findUniqueOrThrow({
      where: { id: 'push-mixed-auth-guest' },
      include: { bookingEntitlements: true },
    })
    expect(stored.revokedAt).not.toBeNull()
    expect(stored.authorizedUserId).toBeNull()
    expect(stored.bookingEntitlements).toEqual([])
  })
})
