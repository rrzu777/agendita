import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'crypto'
import {
  TEST_PUSH_AUTH,
  TEST_VAPID_PRIVATE_KEY,
  TEST_VAPID_PUBLIC_KEY,
} from '../helpers/push-fixtures'

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  verifyPushGrant: vi.fn(),
  checkRateLimit: vi.fn(),
  bookingFindFirst: vi.fn(),
  customerFindMany: vi.fn(),
  storePushSubscription: vi.fn(),
  storeAuthenticatedPushSubscriptions: vi.fn(),
  unsubscribePushSubscription: vi.fn(),
  hasActivePushAssociation: vi.fn(),
}))

vi.mock('@/lib/auth/user', () => ({ getCurrentUser: mocks.getCurrentUser }))
vi.mock('@/lib/push/grant', () => ({ verifyPushGrant: mocks.verifyPushGrant }))
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: mocks.checkRateLimit }))
vi.mock('@/lib/push/subscription', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/push/subscription')>()),
  storePushSubscription: mocks.storePushSubscription,
  storeAuthenticatedPushSubscriptions: mocks.storeAuthenticatedPushSubscriptions,
  unsubscribePushSubscription: mocks.unsubscribePushSubscription,
  hasActivePushAssociation: mocks.hasActivePushAssociation,
}))
vi.mock('@/lib/db', () => ({
  prisma: {
    booking: { findFirst: mocks.bookingFindFirst },
    customer: { findMany: mocks.customerFindMany },
  },
}))

const canonicalOrigin = 'https://www.agendita.cl'
const subscription = {
  endpoint: 'https://fcm.googleapis.com/fcm/send/subscription-1',
  keys: { p256dh: TEST_VAPID_PUBLIC_KEY, auth: TEST_PUSH_AUTH },
}

function pushRequest(path: string, body: unknown, origin = canonicalOrigin, extraHeaders?: HeadersInit) {
  return new Request(`${canonicalOrigin}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin, ...extraHeaders },
    body: JSON.stringify(body),
  })
}

describe('push subscription routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-10T12:00:00.000Z'))
    vi.stubEnv('NEXT_PUBLIC_APP_DOMAIN', 'www.agendita.cl')
    vi.stubEnv('NEXT_PUBLIC_VAPID_PUBLIC_KEY', TEST_VAPID_PUBLIC_KEY)
    vi.stubEnv('VAPID_PRIVATE_KEY', TEST_VAPID_PRIVATE_KEY)
    vi.stubEnv('VAPID_SUBJECT', 'mailto:soporte@agendita.cl')
    vi.stubEnv('ENCRYPTION_KEY', 'encryption-key')
    mocks.checkRateLimit.mockResolvedValue({ success: true, remaining: 9, resetAt: 0 })
    mocks.getCurrentUser.mockResolvedValue(null)
    mocks.storePushSubscription.mockResolvedValue({ id: 'push-1' })
    mocks.storeAuthenticatedPushSubscriptions.mockResolvedValue(0)
    mocks.unsubscribePushSubscription.mockResolvedValue(1)
    mocks.hasActivePushAssociation.mockResolvedValue(false)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it.each([undefined, 'https://tenant.agendita.cl', 'https://www.agendita.cl.evil.test'])(
    'rejects a non-canonical Origin before authorization (%s)',
    async (origin) => {
      const { POST } = await import('@/app/api/push/subscribe/route')
      const request = new Request(`${canonicalOrigin}/api/push/subscribe`, {
        method: 'POST',
        headers: origin ? { 'content-type': 'application/json', origin } : { 'content-type': 'application/json' },
        body: JSON.stringify({ subscription, grant: 'signed-grant' }),
      })

      const response = await POST(request)

      expect(response.status).toBe(403)
      await expect(response.json()).resolves.toEqual({ error: 'Solicitud no autorizada' })
      expect(mocks.verifyPushGrant).not.toHaveBeenCalled()
      expect(mocks.getCurrentUser).not.toHaveBeenCalled()
    },
  )

  it('rejects rate-limited subscribe requests before parsing credentials', async () => {
    mocks.checkRateLimit.mockResolvedValue({ success: false, remaining: 0, resetAt: 0 })
    const { POST } = await import('@/app/api/push/subscribe/route')

    const response = await POST(pushRequest('/api/push/subscribe', { subscription, grant: 'signed-grant' }))

    expect(response.status).toBe(429)
    expect(mocks.verifyPushGrant).not.toHaveBeenCalled()
    expect(mocks.getCurrentUser).not.toHaveBeenCalled()
  })

  it('rejects oversized JSON before authorization or database work', async () => {
    const { POST } = await import('@/app/api/push/subscribe/route')
    const request = pushRequest(
      '/api/push/subscribe',
      { subscription, grant: 'x'.repeat(20_000) },
      canonicalOrigin,
      { 'content-length': '20000' },
    )

    const response = await POST(request)

    expect(response.status).toBe(400)
    expect(mocks.verifyPushGrant).not.toHaveBeenCalled()
  })

  it('cancels an oversized streamed body without Content-Length before fully buffering it', async () => {
    let sent = false
    let cancelled = false
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (!sent) {
          sent = true
          controller.enqueue(new Uint8Array(17 * 1024))
          return
        }
        return new Promise<void>(() => undefined)
      },
      cancel() {
        cancelled = true
      },
    })
    const request = {
      headers: new Headers({ 'content-type': 'application/json', origin: canonicalOrigin }),
      body,
    } as Request
    const { readBoundedJson } = await import('@/lib/push/routes')

    await expect(readBoundedJson(request)).rejects.toThrow('Invalid body')
    expect(cancelled).toBe(true)
  })

  it.each([undefined, 'https://tenant.agendita.cl', 'https://www.agendita.cl.evil.test'])(
    'rejects a non-canonical status Origin before reading endpoint capability (%s)',
    async (origin) => {
      const { POST } = await import('@/app/api/push/status/route')
      const request = new Request(`${canonicalOrigin}/api/push/status`, {
        method: 'POST',
        headers: origin ? { 'content-type': 'application/json', origin } : { 'content-type': 'application/json' },
        body: JSON.stringify({ endpoint: subscription.endpoint }),
      })

      const response = await POST(request)

      expect(response.status).toBe(403)
      await expect(response.json()).resolves.toEqual({ error: 'Solicitud no autorizada' })
      expect(mocks.hasActivePushAssociation).not.toHaveBeenCalled()
    },
  )

  it('rate-limits status before parsing or resolving authorization', async () => {
    mocks.checkRateLimit.mockResolvedValue({ success: false, remaining: 0, resetAt: 0 })
    const { POST } = await import('@/app/api/push/status/route')

    const response = await POST(pushRequest('/api/push/status', { endpoint: subscription.endpoint }))

    expect(response.status).toBe(429)
    expect(mocks.getCurrentUser).not.toHaveBeenCalled()
    expect(mocks.hasActivePushAssociation).not.toHaveBeenCalled()
  })

  it('reports endpoint-possession association as one boolean with a hashed target rate limit', async () => {
    mocks.hasActivePushAssociation.mockResolvedValue(true)
    const { POST } = await import('@/app/api/push/status/route')

    const response = await POST(pushRequest('/api/push/status', { endpoint: subscription.endpoint }))

    expect(response.status).toBe(200)
    const payload = await response.json()
    expect(payload).toEqual({ associated: true })
    expect(mocks.hasActivePushAssociation).toHaveBeenCalledWith({
      endpoint: subscription.endpoint,
      scope: { kind: 'endpoint' },
    })
    const endpointHash = createHash('sha256').update(subscription.endpoint).digest('hex')
    expect(mocks.checkRateLimit).toHaveBeenNthCalledWith(
      2,
      'push-status-target',
      30,
      60_000,
      { keyMode: 'target', targetId: `endpoint:${endpointHash}` },
    )
    expect(JSON.stringify(payload)).not.toContain('count')
  })

  it('checks an exact guest booking entitlement without exposing its identity', async () => {
    mocks.verifyPushGrant.mockReturnValue({
      version: 1,
      bookingId: 'booking-1',
      customerId: 'customer-1',
      businessId: 'business-1',
      expiresAt: Date.now() + 60_000,
    })
    mocks.bookingFindFirst.mockResolvedValue({ id: 'booking-1' })
    const { POST } = await import('@/app/api/push/status/route')

    const response = await POST(pushRequest('/api/push/status', {
      endpoint: subscription.endpoint,
      grant: 'signed-grant',
    }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ associated: false })
    expect(mocks.hasActivePushAssociation).toHaveBeenCalledWith({
      endpoint: subscription.endpoint,
      scope: {
        kind: 'guest',
        target: {
          businessId: 'business-1',
          customerId: 'customer-1',
          authorization: { kind: 'guest', bookingId: 'booking-1' },
        },
      },
    })
  })

  it('checks only the authenticated user association when a session exists', async () => {
    mocks.getCurrentUser.mockResolvedValue({ id: 'user-1' })
    mocks.hasActivePushAssociation.mockResolvedValue(true)
    const { POST } = await import('@/app/api/push/status/route')

    const response = await POST(pushRequest('/api/push/status', { endpoint: subscription.endpoint }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ associated: true })
    expect(mocks.hasActivePushAssociation).toHaveBeenCalledWith({
      endpoint: subscription.endpoint,
      scope: { kind: 'user', userId: 'user-1' },
    })
  })

  it.each(['status', 'subscribe', 'unsubscribe'] as const)(
    'gives the authenticated account precedence over a supplied guest grant for %s',
    async (operation) => {
      mocks.getCurrentUser.mockResolvedValue({ id: 'user-1' })
      mocks.hasActivePushAssociation.mockResolvedValue(true)
      mocks.storeAuthenticatedPushSubscriptions.mockResolvedValue(1)
      const path = `/api/push/${operation}`
      const { POST } = operation === 'status'
        ? await import('@/app/api/push/status/route')
        : operation === 'subscribe'
          ? await import('@/app/api/push/subscribe/route')
          : await import('@/app/api/push/unsubscribe/route')
      const body = operation === 'subscribe'
        ? { subscription, grant: 'signed-grant' }
        : { endpoint: subscription.endpoint, grant: 'signed-grant' }

      const response = await POST(pushRequest(path, body))

      expect(response.status).toBe(200)
      expect(mocks.verifyPushGrant).not.toHaveBeenCalled()
      if (operation === 'status') {
        expect(mocks.hasActivePushAssociation).toHaveBeenCalledWith({
          endpoint: subscription.endpoint,
          scope: { kind: 'user', userId: 'user-1' },
        })
      } else if (operation === 'subscribe') {
        expect(mocks.storeAuthenticatedPushSubscriptions).toHaveBeenCalledWith(expect.objectContaining({
          userId: 'user-1',
        }))
        expect(mocks.storePushSubscription).not.toHaveBeenCalled()
      } else {
        expect(mocks.unsubscribePushSubscription).toHaveBeenCalledWith(expect.objectContaining({
          scope: { kind: 'user', userId: 'user-1' },
        }))
      }
    },
  )

  it('keeps explicit endpoint-possession cleanup independent from an authenticated account and stale grant', async () => {
    mocks.getCurrentUser.mockResolvedValue({ id: 'user-1' })
    const { POST } = await import('@/app/api/push/unsubscribe/route')

    const response = await POST(pushRequest('/api/push/unsubscribe', {
      endpoint: subscription.endpoint,
      endpointPossession: true,
    }))

    expect(response.status).toBe(200)
    expect(mocks.getCurrentUser).not.toHaveBeenCalled()
    expect(mocks.verifyPushGrant).not.toHaveBeenCalled()
    expect(mocks.unsubscribePushSubscription).toHaveBeenCalledWith(expect.objectContaining({
      scope: { kind: 'endpoint' },
    }))
  })

  it('rejects malformed status endpoints before database lookup', async () => {
    const { POST } = await import('@/app/api/push/status/route')

    const response = await POST(pushRequest('/api/push/status', { endpoint: 'https://evil.example.test/push' }))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'Solicitud inválida' })
    expect(mocks.hasActivePushAssociation).not.toHaveBeenCalled()
  })

  it('rejects a non-canonical browser key without reporting a subscription', async () => {
    mocks.getCurrentUser.mockResolvedValue({ id: 'user-1' })
    const { POST } = await import('@/app/api/push/subscribe/route')

    const response = await POST(pushRequest('/api/push/subscribe', {
      subscription: {
        ...subscription,
        keys: { ...subscription.keys, p256dh: `${TEST_VAPID_PUBLIC_KEY}=` },
      },
    }))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'Solicitud inválida' })
    expect(mocks.customerFindMany).not.toHaveBeenCalled()
    expect(mocks.storePushSubscription).not.toHaveBeenCalled()
  })

  it('treats a complete-looking but invalid VAPID configuration as disabled', async () => {
    vi.stubEnv('NEXT_PUBLIC_VAPID_PUBLIC_KEY', 'malformed-public')
    vi.stubEnv('VAPID_PRIVATE_KEY', 'malformed-private')
    vi.stubEnv('VAPID_SUBJECT', 'mailto:soporte@agendita.cl')
    const { hasCompletePushConfig } = await import('@/lib/push/routes')

    expect(hasCompletePushConfig()).toBe(false)
  })

  it('rechecks all guest grant ownership fields before storing one target', async () => {
    mocks.verifyPushGrant.mockReturnValue({
      version: 1,
      bookingId: 'booking-1',
      customerId: 'customer-1',
      businessId: 'business-1',
      expiresAt: Date.now() + 60_000,
    })
    mocks.bookingFindFirst.mockResolvedValue({ id: 'booking-1' })
    const { POST } = await import('@/app/api/push/subscribe/route')

    const response = await POST(pushRequest('/api/push/subscribe', { subscription, grant: 'signed-grant' }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ subscribed: 1 })
    expect(mocks.bookingFindFirst).toHaveBeenCalledWith({
      where: { id: 'booking-1', customerId: 'customer-1', businessId: 'business-1' },
      select: { id: true },
    })
    expect(mocks.storePushSubscription).toHaveBeenCalledWith({
      businessId: 'business-1',
      customerId: 'customer-1',
      subscription,
      authorization: { kind: 'guest', bookingId: 'booking-1' },
    })
    expect(mocks.getCurrentUser).toHaveBeenCalledTimes(1)
    expect(mocks.getCurrentUser.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.verifyPushGrant.mock.invocationCallOrder[0])
  })

  it('fails closed when a validly signed guest grant no longer owns the booking', async () => {
    mocks.verifyPushGrant.mockReturnValue({
      version: 1,
      bookingId: 'booking-1',
      customerId: 'customer-1',
      businessId: 'business-1',
      expiresAt: Date.now() + 60_000,
    })
    mocks.bookingFindFirst.mockResolvedValue(null)
    const { POST } = await import('@/app/api/push/subscribe/route')

    const response = await POST(pushRequest('/api/push/subscribe', { subscription, grant: 'signed-grant' }))

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Solicitud no autorizada' })
    expect(mocks.storePushSubscription).not.toHaveBeenCalled()
  })

  it('delegates authenticated customer selection and storage to one serialized transaction', async () => {
    mocks.getCurrentUser.mockResolvedValue({ id: 'user-1' })
    mocks.storeAuthenticatedPushSubscriptions.mockResolvedValue(2)
    const { POST } = await import('@/app/api/push/subscribe/route')

    const response = await POST(pushRequest('/api/push/subscribe', { subscription }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ subscribed: 2 })
    expect(mocks.storeAuthenticatedPushSubscriptions).toHaveBeenCalledWith({
      userId: 'user-1',
      subscription,
      now: new Date('2026-08-10T12:00:00.000Z'),
    })
    expect(mocks.storePushSubscription).not.toHaveBeenCalled()
    expect(mocks.checkRateLimit).toHaveBeenNthCalledWith(
      2,
      'push-subscribe-target',
      10,
      60_000,
      { keyMode: 'target', targetId: 'user:user-1' },
    )
  })

  it('returns only a count when an authenticated user has no eligible targets', async () => {
    mocks.getCurrentUser.mockResolvedValue({ id: 'user-1' })
    mocks.customerFindMany.mockResolvedValue([])
    const { POST } = await import('@/app/api/push/subscribe/route')

    const response = await POST(pushRequest('/api/push/subscribe', { subscription }))

    await expect(response.json()).resolves.toEqual({ subscribed: 0 })
    expect(mocks.storePushSubscription).not.toHaveBeenCalled()
    expect(mocks.storeAuthenticatedPushSubscriptions).toHaveBeenCalledTimes(1)
  })

  it('subscribes eligible auth targets even when another target reached its device cap', async () => {
    mocks.getCurrentUser.mockResolvedValue({ id: 'user-1' })
    mocks.storeAuthenticatedPushSubscriptions.mockResolvedValue(1)
    const { POST } = await import('@/app/api/push/subscribe/route')

    const response = await POST(pushRequest('/api/push/subscribe', { subscription }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ subscribed: 1 })
  })

  it('revokes every matching endpoint row owned by the authenticated user', async () => {
    mocks.getCurrentUser.mockResolvedValue({ id: 'user-1' })
    mocks.unsubscribePushSubscription.mockResolvedValue(2)
    const { POST } = await import('@/app/api/push/unsubscribe/route')

    const response = await POST(pushRequest('/api/push/unsubscribe', { endpoint: subscription.endpoint }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ unsubscribed: 2 })
    expect(mocks.unsubscribePushSubscription).toHaveBeenCalledWith({
      endpoint: subscription.endpoint,
      scope: { kind: 'user', userId: 'user-1' },
      now: new Date('2026-08-10T12:00:00.000Z'),
    })
  })

  it('canonicalizes equivalent endpoint spellings before authenticated unsubscribe', async () => {
    mocks.getCurrentUser.mockResolvedValue({ id: 'user-1' })
    const { POST } = await import('@/app/api/push/unsubscribe/route')

    const response = await POST(pushRequest('/api/push/unsubscribe', {
      endpoint: 'https://FCM.GOOGLEAPIS.COM:443/fcm/send/subscription-1',
    }))

    expect(response.status).toBe(200)
    expect(mocks.unsubscribePushSubscription).toHaveBeenCalledWith(expect.objectContaining({
      endpoint: 'https://FCM.GOOGLEAPIS.COM:443/fcm/send/subscription-1',
    }))
  })

  it('scopes guest unsubscribe to the reverified customer and business', async () => {
    mocks.verifyPushGrant.mockReturnValue({
      version: 1,
      bookingId: 'booking-1',
      customerId: 'customer-1',
      businessId: 'business-1',
      expiresAt: Date.now() + 60_000,
    })
    mocks.bookingFindFirst.mockResolvedValue({ id: 'booking-1' })
    const { POST } = await import('@/app/api/push/unsubscribe/route')

    const response = await POST(pushRequest('/api/push/unsubscribe', {
      endpoint: subscription.endpoint,
      grant: 'signed-grant',
    }))

    await expect(response.json()).resolves.toEqual({ unsubscribed: 1 })
    expect(mocks.unsubscribePushSubscription).toHaveBeenCalledWith({
      endpoint: subscription.endpoint,
      scope: {
        kind: 'guest',
        target: {
          businessId: 'business-1',
          customerId: 'customer-1',
          bookingId: 'booking-1',
        },
      },
      now: new Date('2026-08-10T12:00:00.000Z'),
    })
  })

  it('rejects calls without a valid guest grant or authenticated session', async () => {
    mocks.verifyPushGrant.mockReturnValue(null)
    const { POST } = await import('@/app/api/push/unsubscribe/route')

    const response = await POST(pushRequest('/api/push/unsubscribe', {
      endpoint: subscription.endpoint,
      grant: 'invalid-grant',
    }))

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Solicitud no autorizada' })
    expect(mocks.unsubscribePushSubscription).not.toHaveBeenCalled()
  })

  it('accepts endpoint possession cleanup without a grant or session and reveals no row count', async () => {
    mocks.getCurrentUser.mockResolvedValue(null)
    mocks.unsubscribePushSubscription.mockResolvedValue(7)
    const { POST } = await import('@/app/api/push/unsubscribe/route')

    const response = await POST(pushRequest('/api/push/unsubscribe', {
      endpoint: subscription.endpoint,
    }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ unsubscribed: true })
    expect(mocks.unsubscribePushSubscription).toHaveBeenCalledWith({
      endpoint: subscription.endpoint,
      scope: { kind: 'endpoint' },
      now: new Date('2026-08-10T12:00:00.000Z'),
    })
    const endpointHash = createHash('sha256').update(subscription.endpoint).digest('hex')
    expect(mocks.checkRateLimit).toHaveBeenNthCalledWith(
      2,
      'push-unsubscribe-target',
      10,
      60_000,
      { keyMode: 'target', targetId: `endpoint:${endpointHash}` },
    )
    expect(JSON.stringify(mocks.checkRateLimit.mock.calls[1])).not.toContain(subscription.endpoint)
  })

  it('uses explicit endpoint possession for stale-grant fallback even with an authenticated session', async () => {
    mocks.getCurrentUser.mockResolvedValue({ id: 'user-1' })
    const { POST } = await import('@/app/api/push/unsubscribe/route')

    const response = await POST(pushRequest('/api/push/unsubscribe', {
      endpoint: subscription.endpoint,
      endpointPossession: true,
    }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ unsubscribed: true })
    expect(mocks.unsubscribePushSubscription).toHaveBeenCalledWith({
      endpoint: subscription.endpoint,
      scope: { kind: 'endpoint' },
      now: new Date('2026-08-10T12:00:00.000Z'),
    })
  })

  it('applies a second rate limit keyed to the exact guest target', async () => {
    mocks.verifyPushGrant.mockReturnValue({
      version: 1,
      bookingId: 'booking-1',
      customerId: 'customer-1',
      businessId: 'business-1',
      expiresAt: Date.now() + 60_000,
    })
    mocks.bookingFindFirst.mockResolvedValue({ id: 'booking-1' })
    const { POST } = await import('@/app/api/push/subscribe/route')

    await POST(pushRequest('/api/push/subscribe', { subscription, grant: 'signed-grant' }))

    expect(mocks.checkRateLimit).toHaveBeenNthCalledWith(
      2,
      'push-subscribe-target',
      10,
      60_000,
      {
        keyMode: 'target',
        targetId: 'guest:business-1:customer-1:booking-1',
      },
    )
  })
})
