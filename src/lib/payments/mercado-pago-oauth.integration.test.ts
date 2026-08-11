import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { prisma } from '@/lib/db'
import { requireTestDatabase } from '../../../tests/integration/setup'
import { decryptSecret, encryptSecret } from './encryption'
import {
  consumeMercadoPagoOAuthAttempt,
  getValidBusinessAccessToken,
  hashMercadoPagoOAuthNonce,
  persistMercadoPagoOAuthAttempt,
} from './mercado-pago-oauth'

requireTestDatabase()

const BUSINESS_ID = 'oauth-refresh-integration-business'
const ACCOUNT_ID = 'oauth-refresh-integration-account'
const PLAN_ID = 'oauth-refresh-integration-plan'
const SUBSCRIPTION_ID = 'oauth-refresh-integration-subscription'
const NOW = new Date('2026-08-11T12:00:00.000Z')

async function cleanup() {
  await prisma.mercadoPagoOAuthAttempt.deleteMany({ where: { businessId: BUSINESS_ID } })
  await prisma.subscriptionNotificationDelivery.deleteMany({ where: { businessId: BUSINESS_ID } })
  await prisma.paymentAccount.deleteMany({ where: { id: ACCOUNT_ID } })
  await prisma.businessSubscription.deleteMany({ where: { id: SUBSCRIPTION_ID } })
  await prisma.business.deleteMany({ where: { id: BUSINESS_ID } })
  await prisma.plan.deleteMany({ where: { id: PLAN_ID } })
}

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = 'oauth-refresh-integration-encryption-key'
  process.env.MERCADO_PAGO_CLIENT_ID = 'client'
  process.env.MERCADO_PAGO_CLIENT_SECRET = 'secret'
  await cleanup()
  await prisma.plan.create({ data: { id: PLAN_ID, name: PLAN_ID, priceMonthly: 14_990, priceYearly: 149_900 } })
  await prisma.business.create({
    data: {
      id: BUSINESS_ID, name: 'OAuth Refresh Integration', slug: BUSINESS_ID,
      subdomain: BUSINESS_ID, ownerUserId: 'oauth-refresh-integration-owner', city: 'Santiago', planId: PLAN_ID,
    },
  })
  await prisma.businessSubscription.create({
    data: {
      id: SUBSCRIPTION_ID, businessId: BUSINESS_ID, planId: PLAN_ID, status: 'trialing',
      amount: 14_990, currency: 'CLP', provider: 'manual', billingEnabled: false,
      currentPeriodStart: NOW, currentPeriodEnd: new Date('2026-09-11T12:00:00.000Z'),
    },
  })
})

beforeEach(async () => {
  await prisma.subscriptionNotificationDelivery.deleteMany({ where: { businessId: BUSINESS_ID } })
  await prisma.paymentAccount.deleteMany({ where: { id: ACCOUNT_ID } })
  await prisma.paymentAccount.create({
    data: {
      id: ACCOUNT_ID, businessId: BUSINESS_ID, provider: 'mercado_pago', environment: 'sandbox',
      status: 'connected', providerAccountId: '12', accessTokenEncrypted: encryptSecret('old-access'),
      refreshTokenEncrypted: encryptSecret('old-refresh'),
      expiresAt: new Date(NOW.getTime() + 60_000), connectedAt: NOW,
    },
  })
})

afterAll(async () => {
  await cleanup()
  await prisma.$disconnect()
})

describe('Mercado Pago OAuth refresh locking', () => {
  it.each([null, '', 'seller-12'])('rejects connected Mercado Pago rows with invalid seller %s at the database boundary', async (providerAccountId) => {
    await expect(prisma.paymentAccount.update({
      where: { id: ACCOUNT_ID }, data: { providerAccountId },
    })).rejects.toThrow()
  })

  it('serializes refresh across concurrent PostgreSQL transactions and preserves the rotated pair', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      access_token: 'rotated-access', refresh_token: 'rotated-refresh', expires_in: 3600,
      user_id: 12,
    }), { status: 200, headers: { 'content-type': 'application/json' } }))

    const values = await Promise.all([
      getValidBusinessAccessToken(BUSINESS_ID, 'sandbox', { fetch, now: () => NOW }),
      getValidBusinessAccessToken(BUSINESS_ID, 'sandbox', { fetch, now: () => NOW }),
    ])

    expect(values).toEqual(['rotated-access', 'rotated-access'])
    expect(fetch).toHaveBeenCalledTimes(1)
    const stored = await prisma.paymentAccount.findUniqueOrThrow({ where: { id: ACCOUNT_ID } })
    expect(decryptSecret(stored.accessTokenEncrypted)).toBe('rotated-access')
    expect(decryptSecret(stored.refreshTokenEncrypted!)).toBe('rotated-refresh')
    expect(stored.status).toBe('connected')
  })

  it('atomically expires invalid_grant and persists the reconnect notification', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'invalid_grant' }), {
      status: 400, headers: { 'content-type': 'application/json' },
    }))
    await expect(getValidBusinessAccessToken(BUSINESS_ID, 'sandbox', { fetch, now: () => NOW }))
      .rejects.toThrow('La conexión con Mercado Pago expiró. Reconecta tu cuenta.')

    const [stored, notification] = await Promise.all([
      prisma.paymentAccount.findUniqueOrThrow({ where: { id: ACCOUNT_ID } }),
      prisma.subscriptionNotificationDelivery.findFirst({ where: { businessId: BUSINESS_ID } }),
    ])
    expect(stored.status).toBe('expired')
    expect(notification).toMatchObject({
      subscriptionId: SUBSCRIPTION_ID, kind: 'subscription_oauth_expired', status: 'pending',
    })
  })

  it('commits the short claim before waiting on provider network', async () => {
    let release!: (response: Response) => void
    const fetch = vi.fn(() => new Promise<Response>((resolve) => { release = resolve }))
    const pending = getValidBusinessAccessToken(BUSINESS_ID, 'sandbox', { fetch, now: () => NOW })
    while (fetch.mock.calls.length === 0) await new Promise((resolve) => setTimeout(resolve, 5))
    const claimed = await prisma.paymentAccount.findUniqueOrThrow({ where: { id: ACCOUNT_ID } })
    expect(claimed.refreshLeaseToken).toBeTruthy()
    release(new Response(JSON.stringify({
      access_token: 'after-network', refresh_token: 'after-network-refresh', expires_in: 3600, user_id: 12,
    }), { status: 200, headers: { 'content-type': 'application/json' } }))
    await expect(pending).resolves.toBe('after-network')
  })

  it('reclaims an expired lease after a crashed owner', async () => {
    await prisma.paymentAccount.update({
      where: { id: ACCOUNT_ID },
      data: { refreshLeaseToken: 'crashed-owner', refreshLeaseExpiresAt: new Date(NOW.getTime() - 1) },
    })
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      access_token: 'reclaimed', refresh_token: 'reclaimed-refresh', expires_in: 3600, user_id: 12,
    }), { status: 200, headers: { 'content-type': 'application/json' } }))
    await expect(getValidBusinessAccessToken(BUSINESS_ID, 'sandbox', { fetch, now: () => NOW }))
      .resolves.toBe('reclaimed')
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('rejects seller mismatch without rotating tokens or corrupting status', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      access_token: 'wrong-seller', refresh_token: 'wrong-seller-refresh', expires_in: 3600, user_id: 99,
    }), { status: 200, headers: { 'content-type': 'application/json' } }))
    await expect(getValidBusinessAccessToken(BUSINESS_ID, 'sandbox', { fetch, now: () => NOW }))
      .rejects.toThrow('Mercado Pago OAuth seller mismatch.')
    const stored = await prisma.paymentAccount.findUniqueOrThrow({ where: { id: ACCOUNT_ID } })
    expect(stored.status).toBe('connected')
    expect(stored.providerAccountId).toBe('12')
    expect(stored.tokenVersion).toBe(0)
    expect(stored.refreshLeaseToken).toBeNull()
    expect(decryptSecret(stored.accessTokenEncrypted)).toBe('old-access')
  })

  it.each([
    ['approved stale response', new Response(JSON.stringify({
      access_token: 'stale-access', refresh_token: 'stale-refresh', expires_in: 3600, user_id: 12,
    }), { status: 200, headers: { 'content-type': 'application/json' } })],
    ['stale invalid_grant', new Response(JSON.stringify({ error: 'invalid_grant' }), {
      status: 400, headers: { 'content-type': 'application/json' },
    })],
  ])('does not let %s overwrite or expire a newer reconnect', async (_name, providerResponse) => {
    let release!: (response: Response) => void
    const fetch = vi.fn(() => new Promise<Response>((resolve) => { release = resolve }))
    const pending = getValidBusinessAccessToken(BUSINESS_ID, 'sandbox', { fetch, now: () => NOW })
    while (fetch.mock.calls.length === 0) await new Promise((resolve) => setTimeout(resolve, 5))
    await prisma.paymentAccount.update({
      where: { id: ACCOUNT_ID },
      data: {
        accessTokenEncrypted: encryptSecret('reconnected-access'),
        refreshTokenEncrypted: encryptSecret('reconnected-refresh'),
        expiresAt: new Date(NOW.getTime() + 3_600_000),
        tokenVersion: { increment: 1 }, refreshLeaseToken: null, refreshLeaseExpiresAt: null,
        status: 'connected', providerAccountId: '12',
      },
    })
    release(providerResponse)
    await expect(pending).resolves.toBe('reconnected-access')
    const stored = await prisma.paymentAccount.findUniqueOrThrow({ where: { id: ACCOUNT_ID } })
    expect(stored.status).toBe('connected')
    expect(decryptSecret(stored.accessTokenEncrypted)).toBe('reconnected-access')
  })

  it('does not finalize a successful refresh at the lease-expiry boundary and allows recovery', async () => {
    let clock = NOW
    let release!: (response: Response) => void
    const fetch = vi.fn()
      .mockImplementationOnce(() => new Promise<Response>((resolve) => { release = resolve }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        access_token: 'recovered-access', refresh_token: 'recovered-refresh', expires_in: 3600, user_id: 12,
      }), { status: 200, headers: { 'content-type': 'application/json' } }))
    const pending = getValidBusinessAccessToken(BUSINESS_ID, 'sandbox', { fetch, now: () => clock })
    while (fetch.mock.calls.length === 0) await new Promise((resolve) => setTimeout(resolve, 5))
    clock = new Date(NOW.getTime() + 10_000)
    release(new Response(JSON.stringify({
      access_token: 'late-access', refresh_token: 'late-refresh', expires_in: 3600, user_id: 12,
    }), { status: 200, headers: { 'content-type': 'application/json' } }))
    await expect(pending).rejects.toThrow(/conflicted|in progress/)
    expect(decryptSecret((await prisma.paymentAccount.findUniqueOrThrow({ where: { id: ACCOUNT_ID } })).accessTokenEncrypted)).toBe('old-access')
    await expect(getValidBusinessAccessToken(BUSINESS_ID, 'sandbox', { fetch, now: () => clock }))
      .resolves.toBe('recovered-access')
  })

  it('does not apply late invalid_grant at the lease-expiry boundary and allows recovery', async () => {
    let clock = NOW
    let release!: (response: Response) => void
    const fetch = vi.fn()
      .mockImplementationOnce(() => new Promise<Response>((resolve) => { release = resolve }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        access_token: 'recovered-access', refresh_token: 'recovered-refresh', expires_in: 3600, user_id: 12,
      }), { status: 200, headers: { 'content-type': 'application/json' } }))
    const pending = getValidBusinessAccessToken(BUSINESS_ID, 'sandbox', { fetch, now: () => clock })
    while (fetch.mock.calls.length === 0) await new Promise((resolve) => setTimeout(resolve, 5))
    clock = new Date(NOW.getTime() + 10_000)
    release(new Response(JSON.stringify({ error: 'invalid_grant' }), {
      status: 400, headers: { 'content-type': 'application/json' },
    }))
    await expect(pending).rejects.toThrow(/conflicted|in progress/)
    expect((await prisma.paymentAccount.findUniqueOrThrow({ where: { id: ACCOUNT_ID } })).status).toBe('connected')
    expect(await prisma.subscriptionNotificationDelivery.count({ where: { businessId: BUSINESS_ID } })).toBe(0)
    await expect(getValidBusinessAccessToken(BUSINESS_ID, 'sandbox', { fetch, now: () => clock }))
      .resolves.toBe('recovered-access')
  })
})

describe('Mercado Pago persisted OAuth attempts', () => {
  it('consumes two starts independently and rejects replay/tenant mismatch', async () => {
    await prisma.mercadoPagoOAuthAttempt.createMany({
      data: [
        { businessId: BUSINESS_ID, environment: 'sandbox', nonceHash: hashMercadoPagoOAuthNonce('nonce-one'), verifierEncrypted: encryptSecret('verifier-one'), createdByUserId: 'user-1', expiresAt: new Date(NOW.getTime() + 60_000) },
        { businessId: BUSINESS_ID, environment: 'sandbox', nonceHash: hashMercadoPagoOAuthNonce('nonce-two'), verifierEncrypted: encryptSecret('verifier-two'), createdByUserId: 'user-1', expiresAt: new Date(NOW.getTime() + 60_000) },
      ],
    })
    await expect(Promise.all([
      consumeMercadoPagoOAuthAttempt({ businessId: BUSINESS_ID, environment: 'sandbox', nonce: 'nonce-one', userId: 'user-1', now: NOW }),
      consumeMercadoPagoOAuthAttempt({ businessId: BUSINESS_ID, environment: 'sandbox', nonce: 'nonce-two', userId: 'user-1', now: NOW }),
    ])).resolves.toEqual(['verifier-one', 'verifier-two'])
    await expect(consumeMercadoPagoOAuthAttempt({ businessId: BUSINESS_ID, environment: 'sandbox', nonce: 'nonce-one', userId: 'user-1', now: NOW })).resolves.toBeNull()
    await expect(consumeMercadoPagoOAuthAttempt({ businessId: BUSINESS_ID, environment: 'production', nonce: 'nonce-two', userId: 'user-1', now: NOW })).resolves.toBeNull()
  })

  it('bounds active starts per business/environment/user without cookie growth', async () => {
    for (let index = 0; index < 6; index += 1) {
      await persistMercadoPagoOAuthAttempt({
        businessId: BUSINESS_ID, environment: 'sandbox', nonce: `bounded-${index}`,
        verifier: `verifier-${index}`, userId: 'user-bounded', now: NOW,
        expiresAt: new Date(NOW.getTime() + 60_000),
      })
    }
    expect(await prisma.mercadoPagoOAuthAttempt.count({
      where: { businessId: BUSINESS_ID, environment: 'sandbox', createdByUserId: 'user-bounded', consumedAt: null },
    })).toBe(5)
    const results = await Promise.all(Array.from({ length: 6 }, (_, index) =>
      consumeMercadoPagoOAuthAttempt({
        businessId: BUSINESS_ID, environment: 'sandbox', nonce: `bounded-${index}`,
        userId: 'user-bounded', now: NOW,
      })))
    expect(results.filter(Boolean)).toHaveLength(5)
  })
})
