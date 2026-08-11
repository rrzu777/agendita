import { BookingStatus } from '@prisma/client'
import { getCurrentUser } from '@/lib/auth/user'
import { getAppUrl } from '@/lib/business/urls'
import { prisma } from '@/lib/db'
import { verifyPushGrant } from '@/lib/push/grant'
import {
  isAllowedWebPushEndpoint,
  type PushSubscriptionAuthorization,
  type PushUnsubscribeScope,
} from '@/lib/push/subscription'

const MAX_BODY_BYTES = 16 * 1024
const MAX_GRANT_LENGTH = 4096
export const MAX_ENDPOINT_LENGTH = 4096

export type PushTarget = {
  businessId: string
  customerId: string
  authorization: PushSubscriptionAuthorization
}

export function hasCompletePushConfig(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
    && process.env.VAPID_PRIVATE_KEY
    && process.env.VAPID_SUBJECT
    && process.env.ENCRYPTION_KEY,
  )
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
  const text = await request.text()
  if (text.length === 0 || Buffer.byteLength(text, 'utf8') > MAX_BODY_BYTES) {
    throw new Error('Invalid body')
  }
  const value: unknown = JSON.parse(text)
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Invalid body')
  }
  return value as Record<string, unknown>
}

async function guestTarget(grant: string): Promise<PushTarget[] | null> {
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
  return [{
    businessId: claims.businessId,
    customerId: claims.customerId,
    authorization: { kind: 'guest', bookingId: claims.bookingId },
  }]
}

export async function resolvePushTargets(grant: unknown): Promise<PushTarget[] | null> {
  if (grant !== undefined && grant !== null) {
    return typeof grant === 'string' ? guestTarget(grant) : null
  }

  const user = await getCurrentUser()
  if (!user) return null

  const customers = await prisma.customer.findMany({
    where: {
      userId: user.id,
      business: { cancellationReminderEnabled: true },
      bookings: {
        some: {
          startDateTime: { gt: new Date() },
          status: {
            in: [
              BookingStatus.pending_payment,
              BookingStatus.pending_confirmation,
              BookingStatus.confirmed,
            ],
          },
        },
      },
    },
    select: { id: true, businessId: true },
  })

  return customers.map((customer) => ({
    businessId: customer.businessId,
    customerId: customer.id,
    authorization: { kind: 'user' as const, userId: user.id },
  }))
}

export async function resolvePushUnsubscribeScope(grant: unknown): Promise<PushUnsubscribeScope | null> {
  if (grant !== undefined && grant !== null) {
    if (typeof grant !== 'string') return null
    const targets = await guestTarget(grant)
    if (!targets) return null
    const [target] = targets
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
  return user ? { kind: 'user', userId: user.id } : null
}

export function pushTargetRateLimitContext(target: PushTarget): {
  businessId: string
  userId?: string
  targetId: string
} {
  return target.authorization.kind === 'user'
    ? {
        businessId: target.businessId,
        userId: target.authorization.userId,
        targetId: target.customerId,
      }
    : {
        businessId: target.businessId,
        targetId: target.authorization.bookingId,
      }
}

export function pushUnsubscribeRateLimitContext(scope: PushUnsubscribeScope): {
  businessId?: string
  userId?: string
  targetId: string
} {
  return scope.kind === 'user'
    ? { userId: scope.userId, targetId: scope.userId }
    : {
        businessId: scope.target.businessId,
        targetId: scope.target.bookingId,
      }
}

export function validPushEndpoint(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_ENDPOINT_LENGTH) return false
  return isAllowedWebPushEndpoint(value)
}
