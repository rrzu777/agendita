import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  TEST_PUSH_AUTH,
  TEST_VAPID_PRIVATE_KEY,
  TEST_VAPID_PUBLIC_KEY,
} from '../helpers/push-fixtures'

const mocks = vi.hoisted(() => ({
  encryptSecret: vi.fn(() => 'ciphertext-only'),
  upsert: vi.fn(),
  setVapidDetails: vi.fn(),
  sendNotification: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  prisma: {
    pushSubscription: {
      upsert: mocks.upsert,
    },
  },
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

  it('encrypts only normalized JSON and resets revocation state on safe upsert', async () => {
    const { storePushSubscription } = await import('@/lib/push/subscription')

    const result = await storePushSubscription({
      businessId: 'business-1',
      customerId: 'customer-1',
      subscription: validSubscription,
    })

    expect(mocks.encryptSecret).toHaveBeenCalledWith(JSON.stringify({
      endpoint: 'https://fcm.googleapis.com/fcm/send/subscription-1',
      keys: { p256dh: TEST_VAPID_PUBLIC_KEY, auth: TEST_PUSH_AUTH },
    }))
    expect(mocks.upsert).toHaveBeenCalledWith({
      where: {
        customerId_endpointHash: {
          customerId: 'customer-1',
          endpointHash: 'b2cd90efe7a9e3a56ace8d387ce4eef5271b3d42bba70044e02b735c8aa1aae8',
        },
      },
      create: {
        businessId: 'business-1',
        customerId: 'customer-1',
        endpointHash: 'b2cd90efe7a9e3a56ace8d387ce4eef5271b3d42bba70044e02b735c8aa1aae8',
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
    expect(result).toEqual({ id: 'push-1' })
    expect(JSON.stringify(result)).not.toContain('must-not-return')
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
