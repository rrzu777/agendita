import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  TEST_PUSH_AUTH,
  TEST_VAPID_PRIVATE_KEY,
  TEST_VAPID_PUBLIC_KEY,
} from '../helpers/push-fixtures'

const mocks = vi.hoisted(() => ({
  encryptSecret: vi.fn(() => 'ciphertext-only'),
  transaction: vi.fn(),
  advisoryLock: vi.fn(),
  bookingFindFirst: vi.fn(),
  customerFindFirst: vi.fn(),
  customerFindMany: vi.fn(),
  subscriptionFindUnique: vi.fn(),
  subscriptionFindMany: vi.fn(),
  subscriptionCount: vi.fn(),
  upsert: vi.fn(),
  entitlementUpsert: vi.fn(),
  entitlementDeleteMany: vi.fn(),
  updateMany: vi.fn(),
  setVapidDetails: vi.fn(),
  sendNotification: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  prisma: {
    $transaction: mocks.transaction,
  },
}))

vi.mock('@/lib/db/advisory-lock', () => ({
  acquireAdvisoryXactLock: mocks.advisoryLock,
}))

vi.mock('@/lib/payments/encryption', () => ({
  encryptSecret: mocks.encryptSecret,
}))

vi.mock('web-push', () => ({
  default: {
    setVapidDetails: mocks.setVapidDetails,
    sendNotification: mocks.sendNotification,
  },
}))

const validSubscription = {
  endpoint: 'https://fcm.googleapis.com/fcm/send/subscription-1',
  expirationTime: null,
  keys: {
    p256dh: TEST_VAPID_PUBLIC_KEY,
    auth: TEST_PUSH_AUTH,
  },
}

describe('push subscription storage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.upsert.mockResolvedValue({ id: 'push-1', subscriptionEncrypted: 'must-not-return' })
    mocks.bookingFindFirst.mockResolvedValue({ id: 'booking-1' })
    mocks.customerFindFirst.mockResolvedValue({ id: 'customer-1' })
    mocks.customerFindMany.mockResolvedValue([])
    mocks.subscriptionFindUnique.mockResolvedValue(null)
    mocks.subscriptionFindMany.mockResolvedValue([{ id: 'push-1', customerId: 'customer-1' }])
    mocks.subscriptionCount.mockResolvedValue(0)
    mocks.entitlementUpsert.mockResolvedValue({ subscriptionId: 'push-1', bookingId: 'booking-1' })
    mocks.entitlementDeleteMany.mockResolvedValue({ count: 1 })
    mocks.updateMany.mockResolvedValue({ count: 1 })
    mocks.transaction.mockImplementation(async (callback) => callback({
      booking: { findFirst: mocks.bookingFindFirst },
      customer: {
        findFirst: mocks.customerFindFirst,
        findMany: mocks.customerFindMany,
      },
      pushSubscription: {
        findUnique: mocks.subscriptionFindUnique,
        findMany: mocks.subscriptionFindMany,
        count: mocks.subscriptionCount,
        upsert: mocks.upsert,
        updateMany: mocks.updateMany,
      },
      pushSubscriptionBooking: {
        upsert: mocks.entitlementUpsert,
        deleteMany: mocks.entitlementDeleteMany,
      },
    }))
  })

  it('normalizes browser JSON to the bounded fields the server stores', async () => {
    const { normalizePushSubscription } = await import('@/lib/push/subscription')

    expect(normalizePushSubscription(validSubscription)).toEqual({
      endpoint: 'https://fcm.googleapis.com/fcm/send/subscription-1',
      keys: { p256dh: TEST_VAPID_PUBLIC_KEY, auth: TEST_PUSH_AUTH },
    })
  })

  it.each([
    'https://updates.push.services.mozilla.com/wpush/v2/subscription-1',
    'https://push.services.mozilla.com/wpush/v2/subscription-1',
    'https://web.push.apple.com/QH123',
    'https://push.apple.com/QH123',
    'https://regional.push.apple.com/QH123',
    'https://wns2-by3p.notify.windows.com/w/?token=subscription-1',
  ])('accepts a known browser push service endpoint: %s', async (endpoint) => {
    const { normalizePushSubscription } = await import('@/lib/push/subscription')

    expect(normalizePushSubscription({ ...validSubscription, endpoint }).endpoint).toBe(endpoint)
  })

  it.each([
    null,
    {},
    { ...validSubscription, endpoint: 'not a URL' },
    { ...validSubscription, endpoint: 'http://fcm.googleapis.com/fcm/send/subscription-1' },
    { ...validSubscription, endpoint: 'https://internal.example.test/subscription-1' },
    { ...validSubscription, endpoint: 'https://fcm.googleapis.com.evil.test/subscription-1' },
    { ...validSubscription, endpoint: 'https://evilpush.apple.com/subscription-1' },
    { ...validSubscription, endpoint: 'https://fcm.googleapis.com/fcm/send/subscription-1#fragment' },
    { ...validSubscription, endpoint: `https://fcm.googleapis.com/${'x'.repeat(4097)}` },
    { ...validSubscription, keys: { ...validSubscription.keys, p256dh: 'x'.repeat(1025) } },
    { ...validSubscription, keys: { ...validSubscription.keys, p256dh: `${TEST_VAPID_PUBLIC_KEY}=` } },
    { ...validSubscription, keys: { ...validSubscription.keys, p256dh: Buffer.alloc(64, 4).toString('base64url') } },
    { ...validSubscription, keys: { ...validSubscription.keys, p256dh: Buffer.alloc(65, 3).toString('base64url') } },
    { ...validSubscription, keys: { ...validSubscription.keys, auth: '' } },
    { ...validSubscription, keys: { ...validSubscription.keys, auth: `${TEST_PUSH_AUTH}=` } },
    { ...validSubscription, keys: { ...validSubscription.keys, auth: Buffer.alloc(15, 7).toString('base64url') } },
  ])('rejects malformed or oversized subscription input', async (input) => {
    const { normalizePushSubscription } = await import('@/lib/push/subscription')

    expect(() => normalizePushSubscription(input)).toThrow('Invalid push subscription')
  })

  it('hashes the capability endpoint with SHA-256', async () => {
    const { hashPushEndpoint } = await import('@/lib/push/subscription')

    expect(hashPushEndpoint(validSubscription.endpoint)).toBe(
      'b2cd90efe7a9e3a56ace8d387ce4eef5271b3d42bba70044e02b735c8aa1aae8',
    )
  })

  it('fingerprints the normalized endpoint and keys so key rotation creates a new generation', async () => {
    const { fingerprintPushSubscription, normalizePushSubscription } = await import('@/lib/push/subscription')
    const normalized = normalizePushSubscription(validSubscription)
    const rotated = normalizePushSubscription({
      ...validSubscription,
      keys: {
        p256dh: TEST_VAPID_PUBLIC_KEY,
        auth: Buffer.alloc(16, 8).toString('base64url'),
      },
    })

    expect(fingerprintPushSubscription(normalized)).toBe(
      'f9e6976bfd25d5d977c3537b5b57bf09a99dbb8ab8b1ec651cbb61cbcbbfd2d5',
    )
    expect(fingerprintPushSubscription(rotated)).not.toBe(fingerprintPushSubscription(normalized))
  })

  it('canonicalizes equivalent endpoint spellings before hashing and storage', async () => {
    const { hashPushEndpoint, normalizePushSubscription } = await import('@/lib/push/subscription')
    const variant = 'https://FCM.GOOGLEAPIS.COM:443/fcm/send/subscription-1'
    const queryVariant = `${variant}?token=A%2FB&attempt=1`
    const canonicalQuery = `${validSubscription.endpoint}?token=A%2FB&attempt=1`

    expect(normalizePushSubscription({ ...validSubscription, endpoint: variant }).endpoint)
      .toBe(validSubscription.endpoint)
    expect(hashPushEndpoint(variant)).toBe(hashPushEndpoint(validSubscription.endpoint))
    expect(normalizePushSubscription({ ...validSubscription, endpoint: queryVariant }).endpoint)
      .toBe(canonicalQuery)
    expect(hashPushEndpoint(queryVariant)).toBe(hashPushEndpoint(canonicalQuery))
  })

  it('stores a guest capability with only the exact booking entitlement', async () => {
    const { storePushSubscription } = await import('@/lib/push/subscription')

    const result = await storePushSubscription({
      businessId: 'business-1',
      customerId: 'customer-1',
      subscription: validSubscription,
      authorization: { kind: 'guest', bookingId: 'booking-1' },
    })

    expect(mocks.encryptSecret).toHaveBeenCalledWith(JSON.stringify({
      endpoint: 'https://fcm.googleapis.com/fcm/send/subscription-1',
      keys: { p256dh: TEST_VAPID_PUBLIC_KEY, auth: TEST_PUSH_AUTH },
    }))
    expect(mocks.upsert).toHaveBeenCalledWith({
      where: {
        customerId_subscriptionFingerprint: {
          customerId: 'customer-1',
          subscriptionFingerprint: 'f9e6976bfd25d5d977c3537b5b57bf09a99dbb8ab8b1ec651cbb61cbcbbfd2d5',
        },
      },
      create: {
        businessId: 'business-1',
        customerId: 'customer-1',
        authorizedUserId: null,
        endpointHash: 'b2cd90efe7a9e3a56ace8d387ce4eef5271b3d42bba70044e02b735c8aa1aae8',
        subscriptionFingerprint: 'f9e6976bfd25d5d977c3537b5b57bf09a99dbb8ab8b1ec651cbb61cbcbbfd2d5',
        subscriptionEncrypted: 'ciphertext-only',
      },
      update: {
        businessId: 'business-1',
        subscriptionEncrypted: 'ciphertext-only',
        failureCount: 0,
        lastFailureAt: null,
        revokedAt: null,
      },
      select: { id: true },
    })
    expect(mocks.bookingFindFirst).toHaveBeenCalledWith({
      where: { id: 'booking-1', customerId: 'customer-1', businessId: 'business-1' },
      select: { id: true },
    })
    expect(mocks.entitlementUpsert).toHaveBeenCalledWith({
      where: {
        subscriptionId_bookingId: { subscriptionId: 'push-1', bookingId: 'booking-1' },
      },
      create: { subscriptionId: 'push-1', bookingId: 'booking-1' },
      update: {},
    })
    expect(mocks.customerFindFirst).not.toHaveBeenCalled()
    expect(result).toEqual({ id: 'push-1' })
    expect(JSON.stringify(result)).not.toContain('must-not-return')
  })

  it('persists authenticated authorization explicitly and creates no guest entitlement', async () => {
    const { storePushSubscription } = await import('@/lib/push/subscription')

    await storePushSubscription({
      businessId: 'business-1',
      customerId: 'customer-1',
      subscription: validSubscription,
      authorization: { kind: 'user', userId: 'user-1' },
    })

    expect(mocks.customerFindFirst).toHaveBeenCalledWith({
      where: { id: 'customer-1', businessId: 'business-1', userId: 'user-1' },
      select: { id: true },
    })
    expect(mocks.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ authorizedUserId: 'user-1' }),
      update: expect.objectContaining({ authorizedUserId: 'user-1' }),
    }))
    expect(mocks.entitlementUpsert).not.toHaveBeenCalled()
  })

  it('requeries and locks the authenticated customer set in deterministic order', async () => {
    const { storeAuthenticatedPushSubscriptions } = await import('@/lib/push/subscription')
    const now = new Date('2026-08-10T12:00:00.000Z')
    mocks.customerFindMany.mockResolvedValue([
      { id: 'customer-2', businessId: 'business-2' },
      { id: 'customer-1', businessId: 'business-1' },
    ])

    await expect(storeAuthenticatedPushSubscriptions({
      userId: 'user-1',
      subscription: validSubscription,
      now,
    })).resolves.toBe(2)

    expect(mocks.customerFindMany).toHaveBeenCalledWith({
      where: {
        userId: 'user-1',
        business: { cancellationReminderEnabled: true },
        bookings: {
          some: {
            startDateTime: { gt: now },
            status: { in: ['pending_payment', 'pending_confirmation', 'confirmed'] },
          },
        },
      },
      select: { id: true, businessId: true },
      orderBy: { id: 'asc' },
    })
    expect(mocks.advisoryLock.mock.calls.map(([, key]) => key)).toEqual([
      'push-authorization:user-1:b2cd90efe7a9e3a56ace8d387ce4eef5271b3d42bba70044e02b735c8aa1aae8',
      'push-subscription:customer-1',
      'push-subscription:customer-2',
    ])
    expect(mocks.upsert).toHaveBeenCalledTimes(2)
  })

  it('hard-rejects a sixth active guest device for one booking', async () => {
    const { PushDeviceLimitError, storePushSubscription } = await import('@/lib/push/subscription')
    mocks.subscriptionCount.mockResolvedValue(5)

    await expect(storePushSubscription({
      businessId: 'business-1',
      customerId: 'customer-1',
      subscription: validSubscription,
      authorization: { kind: 'guest', bookingId: 'booking-1' },
    })).rejects.toBeInstanceOf(PushDeviceLimitError)

    expect(mocks.upsert).not.toHaveBeenCalled()
    expect(mocks.entitlementUpsert).not.toHaveBeenCalled()
  })

  it('moves a guest booking scope off older key generations before enforcing the cap', async () => {
    const { storePushSubscription } = await import('@/lib/push/subscription')
    mocks.subscriptionCount.mockImplementation(async () => (
      mocks.entitlementDeleteMany.mock.calls.length > 0 ? 4 : 5
    ))

    await expect(storePushSubscription({
      businessId: 'business-1',
      customerId: 'customer-1',
      subscription: validSubscription,
      authorization: { kind: 'guest', bookingId: 'booking-1' },
    })).resolves.toEqual({ id: 'push-1' })

    expect(mocks.entitlementDeleteMany).toHaveBeenCalledWith({
      where: {
        bookingId: 'booking-1',
        subscription: {
          businessId: 'business-1',
          customerId: 'customer-1',
          endpointHash: 'b2cd90efe7a9e3a56ace8d387ce4eef5271b3d42bba70044e02b735c8aa1aae8',
          subscriptionFingerprint: {
            not: 'f9e6976bfd25d5d977c3537b5b57bf09a99dbb8ab8b1ec651cbb61cbcbbfd2d5',
          },
        },
      },
    })
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: {
        businessId: 'business-1',
        customerId: 'customer-1',
        endpointHash: 'b2cd90efe7a9e3a56ace8d387ce4eef5271b3d42bba70044e02b735c8aa1aae8',
        subscriptionFingerprint: {
          not: 'f9e6976bfd25d5d977c3537b5b57bf09a99dbb8ab8b1ec651cbb61cbcbbfd2d5',
        },
        authorizedUserId: null,
        revokedAt: null,
        bookingEntitlements: { none: {} },
      },
      data: { revokedAt: expect.any(Date) },
    })
    expect(mocks.entitlementDeleteMany.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.subscriptionCount.mock.invocationCallOrder[0])
  })

  it('moves only auth scope off older key generations and preserves guest entitlements', async () => {
    const { storePushSubscription } = await import('@/lib/push/subscription')
    mocks.subscriptionCount.mockImplementation(async () => (
      mocks.updateMany.mock.calls.some(([{ data }]) => data.authorizedUserId === null)
        ? 4
        : 5
    ))

    await expect(storePushSubscription({
      businessId: 'business-1',
      customerId: 'customer-1',
      subscription: validSubscription,
      authorization: { kind: 'user', userId: 'user-1' },
    })).resolves.toEqual({ id: 'push-1' })

    expect(mocks.updateMany).toHaveBeenNthCalledWith(1, {
      where: {
        businessId: 'business-1',
        customerId: 'customer-1',
        endpointHash: 'b2cd90efe7a9e3a56ace8d387ce4eef5271b3d42bba70044e02b735c8aa1aae8',
        subscriptionFingerprint: {
          not: 'f9e6976bfd25d5d977c3537b5b57bf09a99dbb8ab8b1ec651cbb61cbcbbfd2d5',
        },
        authorizedUserId: 'user-1',
      },
      data: { authorizedUserId: null },
    })
    expect(mocks.updateMany).toHaveBeenNthCalledWith(2, {
      where: {
        businessId: 'business-1',
        customerId: 'customer-1',
        endpointHash: 'b2cd90efe7a9e3a56ace8d387ce4eef5271b3d42bba70044e02b735c8aa1aae8',
        subscriptionFingerprint: {
          not: 'f9e6976bfd25d5d977c3537b5b57bf09a99dbb8ab8b1ec651cbb61cbcbbfd2d5',
        },
        authorizedUserId: null,
        revokedAt: null,
        bookingEntitlements: { none: {} },
      },
      data: { revokedAt: expect.any(Date) },
    })
    expect(mocks.updateMany.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.subscriptionCount.mock.invocationCallOrder[0])
  })

  it('removes auth scope from a revoked older generation while preserving its guest entitlement', async () => {
    const { storePushSubscription } = await import('@/lib/push/subscription')
    const older = {
      authorizedUserId: 'user-1' as string | null,
      revokedAt: new Date('2026-08-10T11:00:00.000Z') as Date | null,
      hasGuestEntitlement: true,
    }
    mocks.updateMany.mockImplementation(async ({ where, data }) => {
      if (data.authorizedUserId === null && where.subscriptionFingerprint?.not) {
        if (where.revokedAt === null && older.revokedAt !== null) return { count: 0 }
        if (where.authorizedUserId === older.authorizedUserId) {
          older.authorizedUserId = null
          return { count: 1 }
        }
      }
      return { count: 0 }
    })

    await storePushSubscription({
      businessId: 'business-1',
      customerId: 'customer-1',
      subscription: validSubscription,
      authorization: { kind: 'user', userId: 'user-1' },
    })

    expect(older).toEqual({
      authorizedUserId: null,
      revokedAt: new Date('2026-08-10T11:00:00.000Z'),
      hasGuestEntitlement: true,
    })
  })

  it('continues an authenticated batch when one customer has five unrelated devices', async () => {
    const { storeAuthenticatedPushSubscriptions } = await import('@/lib/push/subscription')
    mocks.customerFindMany.mockResolvedValue([
      { id: 'customer-1', businessId: 'business-1' },
      { id: 'customer-2', businessId: 'business-2' },
    ])
    mocks.subscriptionCount.mockImplementation(async ({ where }) => (
      where.customerId === 'customer-1' ? 5 : 0
    ))

    await expect(storeAuthenticatedPushSubscriptions({
      userId: 'user-1',
      subscription: validSubscription,
    })).resolves.toBe(1)

    expect(mocks.upsert).toHaveBeenCalledTimes(1)
    expect(mocks.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ customerId: 'customer-2' }),
    }))
  })

  it('guest unsubscribe deletes only the exact booking entitlement and revokes only orphan rows', async () => {
    const { unsubscribePushSubscription } = await import('@/lib/push/subscription')

    await expect(unsubscribePushSubscription({
      endpoint: validSubscription.endpoint,
      scope: {
        kind: 'guest',
        target: { businessId: 'business-1', customerId: 'customer-1', bookingId: 'booking-1' },
      },
      now: new Date('2026-08-10T12:00:00.000Z'),
    })).resolves.toBe(1)

    expect(mocks.entitlementDeleteMany).toHaveBeenCalledWith({
      where: {
        bookingId: 'booking-1',
        subscriptionId: { in: ['push-1'] },
      },
    })
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: {
        id: { in: ['push-1'] },
        authorizedUserId: null,
        revokedAt: null,
        bookingEntitlements: { none: {} },
      },
      data: { revokedAt: new Date('2026-08-10T12:00:00.000Z') },
    })
  })

  it('authenticated unsubscribe clears only matching explicit authorization and preserves entitled rows', async () => {
    const { unsubscribePushSubscription } = await import('@/lib/push/subscription')

    await unsubscribePushSubscription({
      endpoint: validSubscription.endpoint,
      scope: { kind: 'user', userId: 'user-1' },
      now: new Date('2026-08-10T12:00:00.000Z'),
    })

    expect(mocks.updateMany).toHaveBeenNthCalledWith(1, {
      where: {
        id: { in: ['push-1'] },
        authorizedUserId: 'user-1',
      },
      data: { authorizedUserId: null },
    })
    expect(mocks.updateMany).toHaveBeenNthCalledWith(2, {
      where: {
        id: { in: ['push-1'] },
        authorizedUserId: null,
        revokedAt: null,
        bookingEntitlements: { none: {} },
      },
      data: { revokedAt: new Date('2026-08-10T12:00:00.000Z') },
    })
  })

  it('does not resurrect auth when guest re-subscribes the same revoked mixed fingerprint', async () => {
    const {
      storePushSubscription,
      unsubscribePushSubscription,
    } = await import('@/lib/push/subscription')
    const row = {
      authorizedUserId: 'user-1' as string | null,
      revokedAt: new Date('2026-08-10T11:00:00.000Z') as Date | null,
      hasGuestEntitlement: true,
    }
    mocks.subscriptionFindMany.mockImplementation(async ({ where }) => {
      if (where.revokedAt === null && row.revokedAt !== null) return []
      return where.authorizedUserId === row.authorizedUserId
        ? [{ id: 'push-1', customerId: 'customer-1' }]
        : []
    })
    mocks.updateMany.mockImplementation(async ({ where, data }) => {
      if (where.id?.in && data.authorizedUserId === null) {
        if (where.revokedAt === null && row.revokedAt !== null) return { count: 0 }
        if (where.authorizedUserId === row.authorizedUserId) {
          row.authorizedUserId = null
          return { count: 1 }
        }
      }
      return { count: 0 }
    })
    mocks.subscriptionFindUnique.mockImplementation(async () => ({
      id: 'push-1',
      authorizedUserId: row.authorizedUserId,
      revokedAt: row.revokedAt,
      bookingEntitlements: row.hasGuestEntitlement ? [{ bookingId: 'booking-1' }] : [],
    }))
    mocks.upsert.mockImplementation(async ({ update }) => {
      row.revokedAt = update.revokedAt
      if (update.authorizedUserId !== undefined) row.authorizedUserId = update.authorizedUserId
      return { id: 'push-1' }
    })

    await expect(unsubscribePushSubscription({
      endpoint: validSubscription.endpoint,
      scope: { kind: 'user', userId: 'user-1' },
    })).resolves.toBe(1)
    await storePushSubscription({
      businessId: 'business-1',
      customerId: 'customer-1',
      subscription: validSubscription,
      authorization: { kind: 'guest', bookingId: 'booking-1' },
    })

    expect(row).toEqual({
      authorizedUserId: null,
      revokedAt: null,
      hasGuestEntitlement: true,
    })
  })

  it('does not resurrect a guest entitlement when auth re-subscribes the same revoked mixed fingerprint', async () => {
    const {
      storePushSubscription,
      unsubscribePushSubscription,
    } = await import('@/lib/push/subscription')
    const row = {
      authorizedUserId: 'user-1' as string | null,
      revokedAt: new Date('2026-08-10T11:00:00.000Z') as Date | null,
      hasGuestEntitlement: true,
    }
    mocks.subscriptionFindMany.mockImplementation(async ({ where }) => {
      if (where.revokedAt === null && row.revokedAt !== null) return []
      return row.hasGuestEntitlement
        ? [{ id: 'push-1', customerId: 'customer-1' }]
        : []
    })
    mocks.entitlementDeleteMany.mockImplementation(async ({ where }) => {
      if (where.subscriptionId?.in) {
        const count = row.hasGuestEntitlement ? 1 : 0
        row.hasGuestEntitlement = false
        return { count }
      }
      return { count: 0 }
    })
    mocks.subscriptionFindUnique.mockImplementation(async () => ({
      id: 'push-1',
      authorizedUserId: row.authorizedUserId,
      revokedAt: row.revokedAt,
    }))
    mocks.upsert.mockImplementation(async ({ update }) => {
      row.revokedAt = update.revokedAt
      if (update.authorizedUserId !== undefined) row.authorizedUserId = update.authorizedUserId
      return { id: 'push-1' }
    })

    await expect(unsubscribePushSubscription({
      endpoint: validSubscription.endpoint,
      scope: {
        kind: 'guest',
        target: { businessId: 'business-1', customerId: 'customer-1', bookingId: 'booking-1' },
      },
    })).resolves.toBe(1)
    await storePushSubscription({
      businessId: 'business-1',
      customerId: 'customer-1',
      subscription: validSubscription,
      authorization: { kind: 'user', userId: 'user-1' },
    })

    expect(row).toEqual({
      authorizedUserId: 'user-1',
      revokedAt: null,
      hasGuestEntitlement: false,
    })
  })

  it('lets authenticated unsubscribe win when it starts after a serialized subscribe batch', async () => {
    const {
      storeAuthenticatedPushSubscriptions,
      unsubscribePushSubscription,
    } = await import('@/lib/push/subscription')
    const lockTails = new Map<string, Promise<void>>()
    const lockReleases = new WeakMap<object, Array<() => void>>()
    let authorizedUserId: string | null = null
    let releaseCustomerQuery!: () => void
    const customerQueryGate = new Promise<void>((resolve) => { releaseCustomerQuery = resolve })
    let signalCustomerQuery!: () => void
    const customerQueryReached = new Promise<void>((resolve) => { signalCustomerQuery = resolve })
    let signalSecondAuthLock!: () => void
    const secondAuthLockAttempted = new Promise<void>((resolve) => { signalSecondAuthLock = resolve })
    let authLockAttempts = 0

    mocks.customerFindMany.mockImplementation(async () => {
      signalCustomerQuery()
      await customerQueryGate
      return [{ id: 'customer-1', businessId: 'business-1' }]
    })
    mocks.subscriptionFindMany.mockImplementation(async () => (
      authorizedUserId === 'user-1' ? [{ id: 'push-1', customerId: 'customer-1' }] : []
    ))
    mocks.upsert.mockImplementation(async ({ create }) => {
      authorizedUserId = create.authorizedUserId
      return { id: 'push-1' }
    })
    mocks.updateMany.mockImplementation(async ({ where, data }) => {
      if (where.id?.in && data.authorizedUserId === null && authorizedUserId === where.authorizedUserId) {
        authorizedUserId = null
        return { count: 1 }
      }
      return { count: 0 }
    })
    mocks.advisoryLock.mockImplementation(async (tx, key: string) => {
      if (key.startsWith('push-authorization:')) {
        authLockAttempts += 1
        if (authLockAttempts === 2) signalSecondAuthLock()
      }
      const previous = lockTails.get(key) ?? Promise.resolve()
      let release!: () => void
      const held = new Promise<void>((resolve) => { release = resolve })
      lockTails.set(key, previous.then(() => held))
      await previous
      lockReleases.get(tx)?.push(release)
    })
    mocks.transaction.mockImplementation(async (callback) => {
      const tx = {
        booking: { findFirst: mocks.bookingFindFirst },
        customer: {
          findFirst: mocks.customerFindFirst,
          findMany: mocks.customerFindMany,
        },
        pushSubscription: {
          findUnique: mocks.subscriptionFindUnique,
          findMany: mocks.subscriptionFindMany,
          count: mocks.subscriptionCount,
          upsert: mocks.upsert,
          updateMany: mocks.updateMany,
        },
        pushSubscriptionBooking: {
          upsert: mocks.entitlementUpsert,
          deleteMany: mocks.entitlementDeleteMany,
        },
      }
      lockReleases.set(tx, [])
      try {
        return await callback(tx)
      } finally {
        for (const release of lockReleases.get(tx)?.reverse() ?? []) release()
      }
    })

    const subscribe = storeAuthenticatedPushSubscriptions({
      userId: 'user-1',
      subscription: validSubscription,
      now: new Date('2026-08-10T12:00:00.000Z'),
    })
    await customerQueryReached

    let unsubscribeFinished = false
    const unsubscribe = unsubscribePushSubscription({
      endpoint: validSubscription.endpoint,
      scope: { kind: 'user', userId: 'user-1' },
    }).then((count) => {
      unsubscribeFinished = true
      return count
    })
    await secondAuthLockAttempted

    expect(unsubscribeFinished).toBe(false)
    releaseCustomerQuery()

    await expect(subscribe).resolves.toBe(1)
    await expect(unsubscribe).resolves.toBe(1)
    expect(authorizedUserId).toBeNull()
  })
})

describe('web push sender', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('NEXT_PUBLIC_VAPID_PUBLIC_KEY', '')
    vi.stubEnv('VAPID_PRIVATE_KEY', '')
    vi.stubEnv('VAPID_SUBJECT', '')
  })

  it('stays disabled without the complete VAPID trio', async () => {
    const { sendWebPush } = await import('@/lib/push/web-push')

    await expect(sendWebPush(validSubscription, { title: 'Aviso', body: 'Texto', url: 'https://www.agendita.cl/mi/demo' }))
      .resolves.toEqual({ ok: false })
    expect(mocks.sendNotification).not.toHaveBeenCalled()
  })

  it('sends a JSON payload with configured VAPID credentials', async () => {
    vi.stubEnv('NEXT_PUBLIC_VAPID_PUBLIC_KEY', TEST_VAPID_PUBLIC_KEY)
    vi.stubEnv('VAPID_PRIVATE_KEY', TEST_VAPID_PRIVATE_KEY)
    vi.stubEnv('VAPID_SUBJECT', 'mailto:soporte@agendita.cl')
    mocks.sendNotification.mockResolvedValue({ statusCode: 201 })
    const { sendWebPush } = await import('@/lib/push/web-push')

    const payload = {
      title: 'Peluquería Demo',
      body: 'Recordatorio de cancelación',
      url: 'https://www.agendita.cl/mi/demo',
    }
    await expect(sendWebPush(validSubscription, payload)).resolves.toEqual({ ok: true, statusCode: 201 })
    expect(mocks.setVapidDetails).toHaveBeenCalledWith(
      'mailto:soporte@agendita.cl',
      TEST_VAPID_PUBLIC_KEY,
      TEST_VAPID_PRIVATE_KEY,
    )
    expect(mocks.sendNotification).toHaveBeenCalledWith(
      validSubscription,
      JSON.stringify(payload),
      { TTL: 0, timeout: 10_000 },
    )
  })

  it('returns the provider status without leaking the thrown response', async () => {
    vi.stubEnv('NEXT_PUBLIC_VAPID_PUBLIC_KEY', TEST_VAPID_PUBLIC_KEY)
    vi.stubEnv('VAPID_PRIVATE_KEY', TEST_VAPID_PRIVATE_KEY)
    vi.stubEnv('VAPID_SUBJECT', 'https://www.agendita.cl')
    mocks.sendNotification.mockRejectedValue({ statusCode: 410, body: 'secret provider body' })
    const { sendWebPush } = await import('@/lib/push/web-push')

    await expect(sendWebPush(validSubscription, { title: 'Aviso', body: 'Texto', url: 'https://www.agendita.cl/mi/demo' }))
      .resolves.toEqual({ ok: false, statusCode: 410 })
  })

  it('turns invalid runtime VAPID credentials into a safe failed result', async () => {
    vi.stubEnv('NEXT_PUBLIC_VAPID_PUBLIC_KEY', 'malformed-public-vapid')
    vi.stubEnv('VAPID_PRIVATE_KEY', 'malformed-private-vapid')
    vi.stubEnv('VAPID_SUBJECT', 'mailto:push@agendita.cl')
    mocks.setVapidDetails.mockImplementation(() => { throw new Error('provider included credentials') })
    const { sendWebPush } = await import('@/lib/push/web-push')

    await expect(sendWebPush(validSubscription, { title: 'Aviso', body: 'Texto', url: 'https://www.agendita.cl/mi/demo' }))
      .resolves.toEqual({ ok: false })
  })
})
