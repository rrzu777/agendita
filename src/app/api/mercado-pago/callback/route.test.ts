import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  exchangeAuthorizationCode: vi.fn(),
  prisma: {
    businessUser: { findFirst: vi.fn() },
    business: { findUnique: vi.fn() },
    paymentAccount: { upsert: vi.fn() },
  },
  getUser: vi.fn(),
}))

vi.mock('@/lib/db', () => ({ prisma: mocks.prisma }))
vi.mock('@/lib/auth/middleware', () => ({
  createClient: vi.fn(async () => ({ auth: { getUser: mocks.getUser } })),
}))
vi.mock('@/lib/payments/mercado-pago-oauth', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/payments/mercado-pago-oauth')>(),
  exchangeAuthorizationCode: mocks.exchangeAuthorizationCode,
}))

import {
  createMercadoPagoOAuthState,
  MP_OAUTH_PKCE_COOKIE,
} from '@/lib/payments/mercado-pago-oauth'
import { GET } from './route'

function callbackRequest(state: string, pkce?: { nonce: string; verifier: string }) {
  const headers = new Headers()
  if (pkce) {
    const value = Buffer.from(JSON.stringify(pkce)).toString('base64url')
    headers.set('cookie', `${MP_OAUTH_PKCE_COOKIE}=${value}`)
  }
  return new NextRequest(`https://app.example.com/api/mercado-pago/callback?code=auth-code&state=${encodeURIComponent(state)}`, { headers })
}

describe('Mercado Pago business OAuth callback', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.setSystemTime(new Date('2026-08-11T12:00:00.000Z'))
    process.env.ENCRYPTION_KEY = 'test-encryption-key'
    process.env.MERCADO_PAGO_ENVIRONMENT = 'sandbox'
    process.env.MERCADO_PAGO_CLIENT_ID = 'client'
    process.env.MERCADO_PAGO_CLIENT_SECRET = 'secret'
    process.env.MERCADO_PAGO_REDIRECT_URI = 'https://app.example.com/api/mercado-pago/callback'
    mocks.getUser.mockResolvedValue({ data: { user: { id: 'user-1' } } })
    mocks.prisma.businessUser.findFirst.mockResolvedValue({ role: 'owner' })
    mocks.prisma.business.findUnique.mockResolvedValue({ id: 'business-1' })
    mocks.prisma.paymentAccount.upsert.mockResolvedValue({ id: 'account-1' })
    mocks.exchangeAuthorizationCode.mockResolvedValue({
      accessToken: 'access', refreshToken: 'refresh', providerAccountId: 'seller-1',
      expiresAt: new Date('2026-08-11T13:00:00.000Z'),
    })
  })

  it('rejects a state signed for another environment before token exchange', async () => {
    const state = createMercadoPagoOAuthState({
      businessId: 'business-1', environment: 'production', nonce: 'nonce',
      expiresAt: new Date('2026-08-11T12:10:00.000Z'),
    })
    const response = await GET(callbackRequest(state, { nonce: 'nonce', verifier: 'verifier' }))
    expect(response.headers.get('location')).toContain('error=invalid_state')
    expect(mocks.exchangeAuthorizationCode).not.toHaveBeenCalled()
  })

  it('rejects callback replay without its HttpOnly PKCE cookie', async () => {
    const state = createMercadoPagoOAuthState({
      businessId: 'business-1', environment: 'sandbox', nonce: 'nonce',
      expiresAt: new Date('2026-08-11T12:10:00.000Z'),
    })
    const response = await GET(callbackRequest(state))
    expect(response.headers.get('location')).toContain('error=invalid_state')
    expect(mocks.exchangeAuthorizationCode).not.toHaveBeenCalled()
  })

  it('exchanges with the bound verifier, writes only the selected environment, and consumes the cookie', async () => {
    const state = createMercadoPagoOAuthState({
      businessId: 'business-1', environment: 'sandbox', nonce: 'nonce',
      expiresAt: new Date('2026-08-11T12:10:00.000Z'),
    })
    const response = await GET(callbackRequest(state, { nonce: 'nonce', verifier: 'verifier' }))
    expect(mocks.exchangeAuthorizationCode).toHaveBeenCalledWith(expect.objectContaining({
      environment: 'sandbox', code: 'auth-code', codeVerifier: 'verifier',
    }))
    expect(mocks.prisma.paymentAccount.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { businessId_provider_environment: {
        businessId: 'business-1', provider: 'mercado_pago', environment: 'sandbox',
      } },
    }))
    expect(response.headers.get('location')).toContain('success=connected')
    expect(response.headers.getSetCookie().join(';')).toContain(`${MP_OAUTH_PKCE_COOKIE}=;`)
  })
})
