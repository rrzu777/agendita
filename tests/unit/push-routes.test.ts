import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
  updateMany: vi.fn(),
  storePushSubscription: vi.fn(),
}))

vi.mock('@/lib/auth/user', () => ({ getCurrentUser: mocks.getCurrentUser }))
vi.mock('@/lib/push/grant', () => ({ verifyPushGrant: mocks.verifyPushGrant }))
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: mocks.checkRateLimit }))
vi.mock('@/lib/push/subscription', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/push/subscription')>()),
  storePushSubscription: mocks.storePushSubscription,
}))
vi.mock('@/lib/db', () => ({
  prisma: {
    booking: { findFirst: mocks.bookingFindFirst },
    customer: { findMany: mocks.customerFindMany },
    pushSubscription: { updateMany: mocks.updateMany },
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
    mocks.updateMany.mockResolvedValue({ count: 1 })
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
    })
    expect(mocks.getCurrentUser).not.toHaveBeenCalled()
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

  it('targets exactly the authenticated user customers with future non-terminal bookings and reminders enabled', async () => {
    mocks.getCurrentUser.mockResolvedValue({ id: 'user-1' })
    mocks.customerFindMany.mockResolvedValue([
      { id: 'customer-1', businessId: 'business-1' },
      { id: 'customer-2', businessId: 'business-2' },
    ])
    const { POST } = await import('@/app/api/push/subscribe/route')

    const response = await POST(pushRequest('/api/push/subscribe', { subscription }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ subscribed: 2 })
    expect(mocks.customerFindMany).toHaveBeenCalledWith({
      where: {
        userId: 'user-1',
        business: { cancellationReminderEnabled: true },
        bookings: {
          some: {
            startDateTime: { gt: new Date('2026-08-10T12:00:00.000Z') },
            status: { in: ['pending_payment', 'pending_confirmation', 'confirmed'] },
          },
        },
      },
      select: { id: true, businessId: true },
    })
    expect(mocks.storePushSubscription).toHaveBeenCalledTimes(2)
  })

  it('returns only a count when an authenticated user has no eligible targets', async () => {
    mocks.getCurrentUser.mockResolvedValue({ id: 'user-1' })
    mocks.customerFindMany.mockResolvedValue([])
    const { POST } = await import('@/app/api/push/subscribe/route')

    const response = await POST(pushRequest('/api/push/subscribe', { subscription }))

    await expect(response.json()).resolves.toEqual({ subscribed: 0 })
    expect(mocks.storePushSubscription).not.toHaveBeenCalled()
  })

  it('revokes every matching endpoint row owned by the authenticated user', async () => {
    mocks.getCurrentUser.mockResolvedValue({ id: 'user-1' })
    mocks.updateMany.mockResolvedValue({ count: 2 })
    const { POST } = await import('@/app/api/push/unsubscribe/route')

    const response = await POST(pushRequest('/api/push/unsubscribe', { endpoint: subscription.endpoint }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ unsubscribed: 2 })
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: {
        endpointHash: 'b2cd90efe7a9e3a56ace8d387ce4eef5271b3d42bba70044e02b735c8aa1aae8',
        revokedAt: null,
        customer: { userId: 'user-1' },
      },
      data: { revokedAt: new Date('2026-08-10T12:00:00.000Z') },
    })
  })

  it('canonicalizes equivalent endpoint spellings before authenticated unsubscribe', async () => {
    mocks.getCurrentUser.mockResolvedValue({ id: 'user-1' })
    const { POST } = await import('@/app/api/push/unsubscribe/route')

    const response = await POST(pushRequest('/api/push/unsubscribe', {
      endpoint: 'https://FCM.GOOGLEAPIS.COM:443/fcm/send/subscription-1',
    }))

    expect(response.status).toBe(200)
    expect(mocks.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        endpointHash: 'b2cd90efe7a9e3a56ace8d387ce4eef5271b3d42bba70044e02b735c8aa1aae8',
      }),
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
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: {
        endpointHash: 'b2cd90efe7a9e3a56ace8d387ce4eef5271b3d42bba70044e02b735c8aa1aae8',
        customerId: 'customer-1',
        businessId: 'business-1',
        revokedAt: null,
      },
      data: { revokedAt: new Date('2026-08-10T12:00:00.000Z') },
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
    expect(mocks.updateMany).not.toHaveBeenCalled()
  })
})
