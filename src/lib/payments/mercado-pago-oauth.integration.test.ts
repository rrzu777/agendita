import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { prisma } from '@/lib/db'
import { requireTestDatabase } from '../../../tests/integration/setup'
import { decryptSecret, encryptSecret } from './encryption'
import { getValidBusinessAccessToken } from './mercado-pago-oauth'

requireTestDatabase()

const BUSINESS_ID = 'oauth-refresh-integration-business'
const ACCOUNT_ID = 'oauth-refresh-integration-account'
const PLAN_ID = 'oauth-refresh-integration-plan'
const SUBSCRIPTION_ID = 'oauth-refresh-integration-subscription'
const NOW = new Date('2026-08-11T12:00:00.000Z')

async function cleanup() {
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
  await prisma.paymentAccount.deleteMany({ where: { id: ACCOUNT_ID } })
  await prisma.paymentAccount.create({
    data: {
      id: ACCOUNT_ID, businessId: BUSINESS_ID, provider: 'mercado_pago', environment: 'sandbox',
      status: 'connected', accessTokenEncrypted: encryptSecret('old-access'),
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
  it('serializes refresh across concurrent PostgreSQL transactions and preserves the rotated pair', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      access_token: 'rotated-access', refresh_token: 'rotated-refresh', expires_in: 3600,
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
})
