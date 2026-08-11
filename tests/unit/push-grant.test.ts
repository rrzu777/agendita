import { createHash, createHmac } from 'crypto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const ORIGINAL_KEY = process.env.ENCRYPTION_KEY
const KEY = 'push-grant-test-encryption-key-32-bytes'
const NOW = new Date('2026-08-10T12:00:00.000Z')
const DAY = 24 * 60 * 60 * 1000

function signClaims(claims: unknown, prefix = 'push-grant.v1') {
  const payload = Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url')
  const signingKey = createHash('sha256').update(`push-grant-hmac:${KEY}`).digest()
  const signature = createHmac('sha256', signingKey).update(`${prefix}.${payload}`).digest('hex')
  return `${prefix}.${payload}.${signature}`
}

describe('guest push grants', () => {
  beforeEach(() => {
    process.env.ENCRYPTION_KEY = KEY
  })

  afterEach(() => {
    if (ORIGINAL_KEY === undefined) delete process.env.ENCRYPTION_KEY
    else process.env.ENCRYPTION_KEY = ORIGINAL_KEY
  })

  it('binds the booking, customer and business to a versioned 24-hour grant', async () => {
    const { issuePushGrant, verifyPushGrant } = await import('@/lib/push/grant')
    const token = issuePushGrant({ bookingId: 'booking-1', customerId: 'customer-1', businessId: 'business-1' }, NOW)

    expect(token.startsWith('push-grant.v1.')).toBe(true)
    expect(verifyPushGrant(token, NOW)).toEqual({
      version: 1,
      bookingId: 'booking-1',
      customerId: 'customer-1',
      businessId: 'business-1',
      expiresAt: NOW.getTime() + DAY,
    })
  })

  it('expires at the 24-hour boundary', async () => {
    const { issuePushGrant, verifyPushGrant } = await import('@/lib/push/grant')
    const token = issuePushGrant({ bookingId: 'booking-1', customerId: 'customer-1', businessId: 'business-1' }, NOW)

    expect(verifyPushGrant(token, new Date(NOW.getTime() + DAY - 1))).not.toBeNull()
    expect(verifyPushGrant(token, new Date(NOW.getTime() + DAY))).toBeNull()
  })

  it('rejects a signed claim whose expiry is more than 24 hours in the future', async () => {
    const { verifyPushGrant } = await import('@/lib/push/grant')
    const token = signClaims({
      version: 1,
      bookingId: 'booking-1',
      customerId: 'customer-1',
      businessId: 'business-1',
      expiresAt: NOW.getTime() + DAY + 1,
    })

    expect(verifyPushGrant(token, NOW)).toBeNull()
  })

  it('rejects tampering with any bound identifier', async () => {
    const { issuePushGrant, verifyPushGrant } = await import('@/lib/push/grant')
    const token = issuePushGrant({ bookingId: 'booking-1', customerId: 'customer-1', businessId: 'business-1' }, NOW)
    const [prefix, version, payload, signature] = token.split('.')
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
    claims.customerId = 'customer-2'
    const tamperedPayload = Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url')

    expect(verifyPushGrant(`${prefix}.${version}.${tamperedPayload}.${signature}`, NOW)).toBeNull()
  })

  it('rejects a token from the wrong domain prefix even with a matching HMAC', async () => {
    const { verifyPushGrant } = await import('@/lib/push/grant')
    const token = signClaims({
      version: 1,
      bookingId: 'booking-1',
      customerId: 'customer-1',
      businessId: 'business-1',
      expiresAt: NOW.getTime() + DAY,
    }, 'oauth-state.v1')

    expect(verifyPushGrant(token, NOW)).toBeNull()
  })

  it.each([
    '',
    'push-grant.v1.not-base64.00',
    signClaims({ version: 2, bookingId: 'booking-1', customerId: 'customer-1', businessId: 'business-1', expiresAt: NOW.getTime() + DAY }),
    signClaims({ version: 1, bookingId: '', customerId: 'customer-1', businessId: 'business-1', expiresAt: NOW.getTime() + DAY }),
    signClaims({ version: 1, bookingId: 'booking-1', customerId: 'customer-1', businessId: 'business-1', expiresAt: Number.NaN }),
  ])('rejects malformed or unsupported tokens without throwing', async (token) => {
    const { verifyPushGrant } = await import('@/lib/push/grant')
    expect(() => verifyPushGrant(token, NOW)).not.toThrow()
    expect(verifyPushGrant(token, NOW)).toBeNull()
  })
})
