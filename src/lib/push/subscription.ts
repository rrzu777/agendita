import { createHash } from 'crypto'
import { prisma } from '@/lib/db'
import { encryptSecret } from '@/lib/payments/encryption'

const MAX_ENDPOINT_LENGTH = 4096
const MAX_KEY_LENGTH = 1024
const EXACT_PUSH_HOSTS = new Set([
  'fcm.googleapis.com',
  'updates.push.services.mozilla.com',
  'push.services.mozilla.com',
  'web.push.apple.com',
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

export function isAllowedWebPushEndpoint(value: string): boolean {
  try {
    const endpoint = new URL(value)
    const hostname = endpoint.hostname.toLowerCase()
    // The endpoint is later fetched by the server. Limiting it to browser push
    // providers prevents an authenticated client from turning delivery into SSRF.
    return endpoint.protocol === 'https:'
      && !endpoint.port
      && !endpoint.username
      && !endpoint.password
      && (EXACT_PUSH_HOSTS.has(hostname) || hostname.endsWith('.notify.windows.com'))
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

  if (!isAllowedWebPushEndpoint(candidate.endpoint)) {
    throw new Error('Invalid push subscription')
  }

  return {
    endpoint: candidate.endpoint,
    keys: {
      p256dh: keyRecord.p256dh,
      auth: keyRecord.auth,
    },
  }
}

export function hashPushEndpoint(endpoint: string): string {
  return createHash('sha256').update(endpoint, 'utf8').digest('hex')
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
