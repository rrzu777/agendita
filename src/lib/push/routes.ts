import { getCurrentUser } from '@/lib/auth/user'
import { getAppUrl } from '@/lib/business/urls'
import { prisma } from '@/lib/db'
import { verifyPushGrant } from '@/lib/push/grant'
import { hasUsablePushConfig } from '@/lib/push/config'
import {
  hashPushEndpoint,
  isAllowedWebPushEndpoint,
  type PushStatusScope,
  type PushSubscriptionAuthorization,
  type PushUnsubscribeScope,
} from '@/lib/push/subscription'

const MAX_BODY_BYTES = 16 * 1024
const MAX_GRANT_LENGTH = 4096
export const MAX_ENDPOINT_LENGTH = 4096

export type PushTarget = {
  businessId: string
  customerId: string
  authorization: Extract<PushSubscriptionAuthorization, { kind: 'guest' }>
}

export type PushSubscribeScope =
  | { kind: 'guest'; target: PushTarget }
  | { kind: 'user'; userId: string }

export function hasCompletePushConfig(): boolean {
  return hasUsablePushConfig()
}

export function hasCanonicalOrigin(request: Request): boolean {
  const origin = request.headers.get('origin')
  if (!origin) return false
  try {
    return new URL(origin).origin === new URL(getAppUrl('')).origin && origin === new URL(origin).origin
  } catch {
    return false
  }
}

export async function readBoundedJson(request: Request): Promise<Record<string, unknown>> {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    throw new Error('Invalid body')
  }
  const contentLength = request.headers.get('content-length')
  if (contentLength !== null) {
    const parsed = Number(contentLength)
    if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > MAX_BODY_BYTES) {
      throw new Error('Invalid body')
    }
  }
  if (!request.body) throw new Error('Invalid body')
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let totalBytes = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      totalBytes += value.byteLength
      if (totalBytes > MAX_BODY_BYTES) {
        await reader.cancel()
        throw new Error('Invalid body')
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  if (totalBytes === 0) {
    throw new Error('Invalid body')
  }
  const bytes = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  const value: unknown = JSON.parse(text)
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Invalid body')
  }
  return value as Record<string, unknown>
}

async function guestTarget(grant: string): Promise<PushTarget | null> {
  if (grant.length === 0 || grant.length > MAX_GRANT_LENGTH) return null
  const claims = verifyPushGrant(grant)
  if (!claims) return null

  const booking = await prisma.booking.findFirst({
    where: {
      id: claims.bookingId,
      customerId: claims.customerId,
      businessId: claims.businessId,
    },
    select: { id: true },
  })
  if (!booking) return null
  return {
    businessId: claims.businessId,
    customerId: claims.customerId,
    authorization: { kind: 'guest', bookingId: claims.bookingId },
  }
}

export async function resolvePushSubscribeScope(grant: unknown): Promise<PushSubscribeScope | null> {
  if (grant !== undefined && grant !== null) {
    if (typeof grant !== 'string') return null
    const target = await guestTarget(grant)
    return target ? { kind: 'guest', target } : null
  }

  const user = await getCurrentUser()
  return user ? { kind: 'user', userId: user.id } : null
}

export async function resolvePushUnsubscribeScope(
  grant: unknown,
  endpointPossession = false,
): Promise<PushUnsubscribeScope | null> {
  if (endpointPossession) {
    return grant === undefined || grant === null ? { kind: 'endpoint' } : null
  }
  if (grant !== undefined && grant !== null) {
    if (typeof grant !== 'string') return null
    const target = await guestTarget(grant)
    if (!target) return null
    if (target.authorization.kind !== 'guest') return null
    return {
      kind: 'guest',
      target: {
        businessId: target.businessId,
        customerId: target.customerId,
        bookingId: target.authorization.bookingId,
      },
    }
  }

  const user = await getCurrentUser()
  return user ? { kind: 'user', userId: user.id } : { kind: 'endpoint' }
}

export async function resolvePushStatusScope(grant: unknown): Promise<PushStatusScope | null> {
  if (grant !== undefined && grant !== null) {
    if (typeof grant !== 'string') return null
    const target = await guestTarget(grant)
    return target ? { kind: 'guest', target } : null
  }

  const user = await getCurrentUser()
  return user ? { kind: 'user', userId: user.id } : { kind: 'endpoint' }
}

export function pushTargetRateLimitContext(scope: PushSubscribeScope): {
  keyMode: 'target'
  targetId: string
} {
  return scope.kind === 'user'
    ? {
        keyMode: 'target',
        targetId: `user:${scope.userId}`,
      }
    : {
        keyMode: 'target',
        targetId: `guest:${scope.target.businessId}:${scope.target.customerId}:${scope.target.authorization.bookingId}`,
      }
}

export function pushUnsubscribeRateLimitContext(scope: PushUnsubscribeScope, endpoint?: string): {
  keyMode: 'target'
  targetId: string
} {
  if (scope.kind === 'endpoint') {
    if (!endpoint) throw new Error('Endpoint is required for possession cleanup')
    return { keyMode: 'target', targetId: `endpoint:${hashPushEndpoint(endpoint)}` }
  }
  return scope.kind === 'user'
    ? { keyMode: 'target', targetId: `user:${scope.userId}` }
    : {
        keyMode: 'target',
        targetId: `guest:${scope.target.businessId}:${scope.target.customerId}:${scope.target.bookingId}`,
      }
}

export function pushStatusRateLimitContext(endpoint: string): {
  keyMode: 'target'
  targetId: string
} {
  return { keyMode: 'target', targetId: `endpoint:${hashPushEndpoint(endpoint)}` }
}

export function validPushEndpoint(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_ENDPOINT_LENGTH) return false
  return isAllowedWebPushEndpoint(value)
}
