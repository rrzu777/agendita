import { createHash } from 'crypto'
import { prisma } from '@/lib/db'
import { acquireAdvisoryXactLock } from '@/lib/db/advisory-lock'
import { encryptSecret } from '@/lib/payments/encryption'
import { decodeCanonicalBase64Url, isValidVapidPublicKey } from './vapid-validation'

const MAX_ENDPOINT_LENGTH = 4096
const MAX_KEY_LENGTH = 1024
const MAX_ACTIVE_DEVICES = 5
const EXACT_PUSH_HOSTS = new Set([
  'fcm.googleapis.com',
  'updates.push.services.mozilla.com',
  'push.services.mozilla.com',
  'push.apple.com',
])

export type NormalizedPushSubscription = {
  endpoint: string
  keys: {
    p256dh: string
    auth: string
  }
}

export type PushSubscriptionAuthorization =
  | { kind: 'guest'; bookingId: string }
  | { kind: 'user'; userId: string }

export type PushUnsubscribeScope =
  | {
      kind: 'guest'
      target: { businessId: string; customerId: string; bookingId: string }
    }
  | { kind: 'user'; userId: string }

export class PushDeviceLimitError extends Error {
  constructor() {
    super('Push device limit reached')
    this.name = 'PushDeviceLimitError'
  }
}

function boundedString(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength
}

function isAllowedPushHost(hostname: string): boolean {
  return EXACT_PUSH_HOSTS.has(hostname)
    || hostname.endsWith('.notify.windows.com')
    || hostname.endsWith('.push.apple.com')
}

export function canonicalizeWebPushEndpoint(value: string): string {
  if (!boundedString(value, MAX_ENDPOINT_LENGTH)) {
    throw new Error('Invalid push subscription')
  }

  let endpoint: URL
  try {
    endpoint = new URL(value)
  } catch {
    throw new Error('Invalid push subscription')
  }
  const hostname = endpoint.hostname.toLowerCase()
  if (
    endpoint.protocol !== 'https:'
    || endpoint.port
    || endpoint.username
    || endpoint.password
    || endpoint.hash
    || !isAllowedPushHost(hostname)
  ) {
    throw new Error('Invalid push subscription')
  }

  return endpoint.href
}

export function isAllowedWebPushEndpoint(value: string): boolean {
  try {
    // The endpoint is later fetched by the server. Limiting it to browser push
    // providers prevents an authenticated client from turning delivery into SSRF.
    canonicalizeWebPushEndpoint(value)
    return true
  } catch {
    return false
  }
}

export function normalizePushSubscription(value: unknown): NormalizedPushSubscription {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Invalid push subscription')
  }

  const candidate = value as Record<string, unknown>
  const keys = candidate.keys
  if (typeof keys !== 'object' || keys === null || Array.isArray(keys)) {
    throw new Error('Invalid push subscription')
  }
  const keyRecord = keys as Record<string, unknown>

  if (
    !boundedString(candidate.endpoint, MAX_ENDPOINT_LENGTH)
    || !boundedString(keyRecord.p256dh, MAX_KEY_LENGTH)
    || !boundedString(keyRecord.auth, MAX_KEY_LENGTH)
  ) {
    throw new Error('Invalid push subscription')
  }

  const p256dh = decodeCanonicalBase64Url(keyRecord.p256dh)
  const auth = decodeCanonicalBase64Url(keyRecord.auth)
  if (
    !isValidVapidPublicKey(keyRecord.p256dh)
    || !p256dh
    || p256dh.length !== 65
    || !auth
    || auth.length !== 16
  ) {
    throw new Error('Invalid push subscription')
  }

  return {
    endpoint: canonicalizeWebPushEndpoint(candidate.endpoint),
    keys: {
      p256dh: keyRecord.p256dh,
      auth: keyRecord.auth,
    },
  }
}

export function hashPushEndpoint(endpoint: string): string {
  return createHash('sha256').update(canonicalizeWebPushEndpoint(endpoint), 'utf8').digest('hex')
}

export function fingerprintPushSubscription(
  subscription: NormalizedPushSubscription,
): string {
  return createHash('sha256')
    .update(JSON.stringify(subscription), 'utf8')
    .digest('hex')
}

export async function storePushSubscription({
  businessId,
  customerId,
  subscription,
  authorization,
}: {
  businessId: string
  customerId: string
  subscription: unknown
  authorization: PushSubscriptionAuthorization
}): Promise<{ id: string }> {
  const normalized = normalizePushSubscription(subscription)
  const endpointHash = hashPushEndpoint(normalized.endpoint)
  const subscriptionFingerprint = fingerprintPushSubscription(normalized)
  const subscriptionEncrypted = encryptSecret(JSON.stringify(normalized))

  return prisma.$transaction(async (tx) => {
    // Serializing one Customer keeps the five-device cap exact even when
    // multiple browser tabs subscribe concurrently with different keys.
    await acquireAdvisoryXactLock(tx, `push-subscription:${customerId}`)

    if (authorization.kind === 'guest') {
      const booking = await tx.booking.findFirst({
        where: { id: authorization.bookingId, customerId, businessId },
        select: { id: true },
      })
      if (!booking) throw new Error('Push authorization no longer owns booking')
    } else {
      const customer = await tx.customer.findFirst({
        where: { id: customerId, businessId, userId: authorization.userId },
        select: { id: true },
      })
      if (!customer) throw new Error('Push authorization no longer owns customer')
    }

    const existing = await tx.pushSubscription.findUnique({
      where: {
        customerId_subscriptionFingerprint: { customerId, subscriptionFingerprint },
      },
      select: {
        id: true,
        revokedAt: true,
        authorizedUserId: true,
        bookingEntitlements: authorization.kind === 'guest'
          ? {
              where: { bookingId: authorization.bookingId },
              select: { bookingId: true },
              take: 1,
            }
          : false,
      },
    })
    const alreadyAuthorized = existing?.revokedAt === null && (
      authorization.kind === 'user'
        ? existing.authorizedUserId === authorization.userId
        : existing.bookingEntitlements.length > 0
    )

    if (!alreadyAuthorized) {
      const activeDevices = await tx.pushSubscription.count({
        where: {
          businessId,
          customerId,
          revokedAt: null,
          ...(authorization.kind === 'user'
            ? { authorizedUserId: authorization.userId }
            : {
                bookingEntitlements: {
                  some: { bookingId: authorization.bookingId },
                },
              }),
        },
      })
      if (activeDevices >= MAX_ACTIVE_DEVICES) throw new PushDeviceLimitError()
    }

    const stored = await tx.pushSubscription.upsert({
      where: {
        customerId_subscriptionFingerprint: { customerId, subscriptionFingerprint },
      },
      create: {
        businessId,
        customerId,
        authorizedUserId: authorization.kind === 'user' ? authorization.userId : null,
        endpointHash,
        subscriptionFingerprint,
        subscriptionEncrypted,
      },
      update: {
        businessId,
        ...(authorization.kind === 'user' ? { authorizedUserId: authorization.userId } : {}),
        subscriptionEncrypted,
        failureCount: 0,
        lastFailureAt: null,
        revokedAt: null,
      },
      select: { id: true },
    })

    if (authorization.kind === 'guest') {
      await tx.pushSubscriptionBooking.upsert({
        where: {
          subscriptionId_bookingId: {
            subscriptionId: stored.id,
            bookingId: authorization.bookingId,
          },
        },
        create: { subscriptionId: stored.id, bookingId: authorization.bookingId },
        update: {},
      })
    }

    return { id: stored.id }
  })
}

export async function unsubscribePushSubscription({
  endpoint,
  scope,
  now = new Date(),
}: {
  endpoint: string
  scope: PushUnsubscribeScope
  now?: Date
}): Promise<number> {
  const endpointHash = hashPushEndpoint(endpoint)

  return prisma.$transaction(async (tx) => {
    if (scope.kind === 'guest') {
      const { target } = scope
      await acquireAdvisoryXactLock(tx, `push-subscription:${target.customerId}`)
      const booking = await tx.booking.findFirst({
        where: {
          id: target.bookingId,
          customerId: target.customerId,
          businessId: target.businessId,
        },
        select: { id: true },
      })
      if (!booking) throw new Error('Push authorization no longer owns booking')

      const subscriptions = await tx.pushSubscription.findMany({
        where: {
          endpointHash,
          customerId: target.customerId,
          businessId: target.businessId,
          revokedAt: null,
          bookingEntitlements: { some: { bookingId: target.bookingId } },
        },
        select: { id: true, customerId: true },
      })
      const ids = subscriptions.map(({ id }) => id)
      if (ids.length === 0) return 0

      const removed = await tx.pushSubscriptionBooking.deleteMany({
        where: { bookingId: target.bookingId, subscriptionId: { in: ids } },
      })
      await tx.pushSubscription.updateMany({
        where: {
          id: { in: ids },
          authorizedUserId: null,
          revokedAt: null,
          bookingEntitlements: { none: {} },
        },
        data: { revokedAt: now },
      })
      return removed.count
    }

    const subscriptions = await tx.pushSubscription.findMany({
      where: {
        endpointHash,
        authorizedUserId: scope.userId,
        revokedAt: null,
      },
      select: { id: true, customerId: true },
    })
    const ids = subscriptions.map(({ id }) => id)
    if (ids.length === 0) return 0

    const cleared = await tx.pushSubscription.updateMany({
      where: {
        id: { in: ids },
        authorizedUserId: scope.userId,
        revokedAt: null,
      },
      data: { authorizedUserId: null },
    })
    await tx.pushSubscription.updateMany({
      where: {
        id: { in: ids },
        authorizedUserId: null,
        revokedAt: null,
        bookingEntitlements: { none: {} },
      },
      data: { revokedAt: now },
    })
    return cleared.count
  })
}
