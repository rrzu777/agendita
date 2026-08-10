import { createHash } from 'crypto'
import { prisma } from '@/lib/db'
import { encryptSecret } from '@/lib/payments/encryption'
import { decodeCanonicalBase64Url, isValidVapidPublicKey } from './vapid-validation'

const MAX_ENDPOINT_LENGTH = 4096
const MAX_KEY_LENGTH = 1024
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

export async function storePushSubscription({
  businessId,
  customerId,
  subscription,
}: {
  businessId: string
  customerId: string
  subscription: unknown
}): Promise<{ id: string }> {
  const normalized = normalizePushSubscription(subscription)
  const endpointHash = hashPushEndpoint(normalized.endpoint)
  const subscriptionEncrypted = encryptSecret(JSON.stringify(normalized))

  const stored = await prisma.pushSubscription.upsert({
    where: {
      customerId_endpointHash: { customerId, endpointHash },
    },
    create: {
      businessId,
      customerId,
      endpointHash,
      subscriptionEncrypted,
    },
    update: {
      businessId,
      subscriptionEncrypted,
      failureCount: 0,
      lastFailureAt: null,
      revokedAt: null,
    },
    select: { id: true },
  })
  return { id: stored.id }
}
