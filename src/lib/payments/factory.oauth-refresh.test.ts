import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  prisma: {},
  createProvider: vi.fn((accessToken: string) => ({ accessToken })),
}))

vi.mock('@/lib/db', () => ({ prisma: mocks.prisma }))
vi.mock('./mercado-pago-provider', () => ({
  mercadoPagoPaymentProvider: {},
  createMercadoPagoProvider: mocks.createProvider,
}))

import { encryptSecret } from './encryption'
import {
  getValidBusinessAccessToken,
  type BusinessOAuthAccount,
  type MercadoPagoOAuthRepository,
} from './mercado-pago-oauth'
import { getMercadoPagoProviderForBusiness } from './factory'

const NOW = new Date('2026-08-11T12:00:00.000Z')

function account(overrides: Partial<BusinessOAuthAccount> = {}): BusinessOAuthAccount {
  return {
    id: 'account-1', businessId: 'business-1', environment: 'sandbox', status: 'connected',
    providerAccountId: '12', tokenVersion: 0,
    refreshLeaseToken: null, refreshLeaseExpiresAt: null,
    accessTokenEncrypted: encryptSecret('old-access'),
    refreshTokenEncrypted: encryptSecret('old-refresh'),
    expiresAt: new Date('2026-08-11T14:00:00.000Z'),
    ...overrides,
  }
}

function repository(initial: BusinessOAuthAccount) {
  let current = initial
  const repo: MercadoPagoOAuthRepository = {
    findConnectedAccount: vi.fn(async ({ businessId, accountId, environment }) =>
      (!businessId || current.businessId === businessId) && (!accountId || current.id === accountId) &&
      current.environment === environment && current.status === 'connected'
        ? current : null),
    claimRefresh: vi.fn(async (candidate, claimToken, now, leaseExpiresAt) => {
      if (current.tokenVersion !== candidate.tokenVersion || current.status !== 'connected') return false
      if (current.refreshLeaseToken && current.refreshLeaseExpiresAt && current.refreshLeaseExpiresAt > now) return false
      current = { ...current, refreshLeaseToken: claimToken, refreshLeaseExpiresAt: leaseExpiresAt }
      return true
    }),
    releaseRefreshClaim: vi.fn(async (candidate, claimToken) => {
      if (current.tokenVersion === candidate.tokenVersion && current.refreshLeaseToken === claimToken) {
        current = { ...current, refreshLeaseToken: null, refreshLeaseExpiresAt: null }
      }
    }),
    replaceTokens: vi.fn(async (candidate, claimToken, update) => {
      if (current.tokenVersion !== candidate.tokenVersion || current.refreshLeaseToken !== claimToken) return false
      current = {
        ...current, ...update, status: 'connected', tokenVersion: current.tokenVersion + 1,
        refreshLeaseToken: null, refreshLeaseExpiresAt: null,
      }
      return true
    }),
    expireClaimAndQueue: vi.fn(async (candidate, claimToken) => {
      if (current.status !== 'connected' || current.tokenVersion !== candidate.tokenVersion || current.refreshLeaseToken !== claimToken) return false
      current = {
        ...current, status: 'expired', tokenVersion: current.tokenVersion + 1,
        refreshLeaseToken: null, refreshLeaseExpiresAt: null,
      }
      return true
    }),
  }
  return repo
}

describe('business OAuth token refresh', () => {
  beforeEach(() => {
    process.env.ENCRYPTION_KEY = 'test-encryption-key'
    process.env.MERCADO_PAGO_ENVIRONMENT = 'sandbox'
    process.env.MERCADO_PAGO_CLIENT_ID = 'client'
    process.env.MERCADO_PAGO_CLIENT_SECRET = 'secret'
    process.env.MERCADO_PAGO_REDIRECT_URI = 'https://example.com/callback'
    mocks.createProvider.mockClear()
  })

  it('returns a current token without refreshing', async () => {
    const repo = repository(account())
    const fetch = vi.fn()
    await expect(getValidBusinessAccessToken('business-1', 'sandbox', { repository: repo, fetch, now: () => NOW }))
      .resolves.toBe('old-access')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('refreshes an expiring token only once under concurrency', async () => {
    const repo = repository(account({ expiresAt: new Date('2026-08-11T12:01:00.000Z') }))
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 3600,
      user_id: 12,
    }), { status: 200, headers: { 'content-type': 'application/json' } }))

    const values = await Promise.all([
      getValidBusinessAccessToken('business-1', 'sandbox', { repository: repo, fetch, now: () => NOW }),
      getValidBusinessAccessToken('business-1', 'sandbox', { repository: repo, fetch, now: () => NOW }),
    ])
    expect(values).toEqual(['new-access', 'new-access'])
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({
      grant_type: 'refresh_token', refresh_token: 'old-refresh', test_token: true,
    })
  })

  it('preserves the previous token pair on an invalid success response', async () => {
    const original = account({ expiresAt: new Date('2026-08-11T12:01:00.000Z') })
    const repo = repository(original)
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ expires_in: 3600 }), {
      status: 200, headers: { 'content-type': 'application/json' },
    }))
    await expect(getValidBusinessAccessToken('business-1', 'sandbox', { repository: repo, fetch, now: () => NOW }))
      .rejects.toThrow('Mercado Pago OAuth returned an invalid token response.')
    expect(repo.replaceTokens).not.toHaveBeenCalled()
    expect(repo.expireClaimAndQueue).not.toHaveBeenCalled()
  })

  it('rejects a refresh seller mismatch without rotating or expiring the account', async () => {
    const repo = repository(account({
      providerAccountId: '12', expiresAt: new Date('2026-08-11T12:01:00.000Z'),
    }))
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      access_token: 'attacker-access', refresh_token: 'attacker-refresh', expires_in: 3600, user_id: 99,
    }), { status: 200, headers: { 'content-type': 'application/json' } }))
    await expect(getValidBusinessAccessToken('business-1', 'sandbox', { repository: repo, fetch, now: () => NOW }))
      .rejects.toThrow('Mercado Pago OAuth seller mismatch.')
    expect(repo.replaceTokens).not.toHaveBeenCalled()
    expect(repo.expireClaimAndQueue).not.toHaveBeenCalled()
  })

  it('fails legacy rows without seller ownership closed and requires reconnect', async () => {
    const repo = repository(account({
      providerAccountId: null, expiresAt: new Date('2026-08-11T12:01:00.000Z'),
    }))
    const fetch = vi.fn()
    await expect(getValidBusinessAccessToken('business-1', 'sandbox', { repository: repo, fetch, now: () => NOW }))
      .rejects.toThrow('La conexión con Mercado Pago expiró. Reconecta tu cuenta.')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('marks invalid_grant expired once and queues a durable reconnect notice', async () => {
    const repo = repository(account({ expiresAt: new Date('2026-08-11T12:01:00.000Z') }))
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'invalid_grant' }), {
      status: 400, headers: { 'content-type': 'application/json' },
    }))
    await expect(getValidBusinessAccessToken('business-1', 'sandbox', { repository: repo, fetch, now: () => NOW }))
      .rejects.toThrow('La conexión con Mercado Pago expiró. Reconecta tu cuenta.')
    expect(repo.expireClaimAndQueue).toHaveBeenCalledTimes(1)
  })

  it('never selects a sandbox account for a production provider', async () => {
    const repo = repository(account())
    await expect(getValidBusinessAccessToken('business-1', 'production', {
      repository: repo, fetch: vi.fn(), now: () => NOW,
    })).rejects.toThrow('Este negocio no tiene Mercado Pago conectado.')
  })

  it('factory obtains a valid business token and never falls back to a global token', async () => {
    process.env.MERCADO_PAGO_ACCESS_TOKEN = 'global-token-must-not-be-used'
    const repo = repository(account())
    const provider = await getMercadoPagoProviderForBusiness('business-1', { oauthRepository: repo, now: () => NOW })
    expect(provider).toEqual({ accessToken: 'old-access' })
    expect(mocks.createProvider).toHaveBeenCalledWith('old-access')
  })
})
