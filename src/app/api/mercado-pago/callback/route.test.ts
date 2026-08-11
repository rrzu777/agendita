import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  exchangeAuthorizationCode: vi.fn(),
  prisma: {
    businessUser: { findFirst: vi.fn() },
    business: { findUnique: vi.fn() },
    paymentAccount: { upsert: vi.fn() },
    mercadoPagoOAuthAttempt: { findFirst: vi.fn(), updateMany: vi.fn() },
    $transaction: vi.fn(),
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

import { createMercadoPagoOAuthState } from '@/lib/payments/mercado-pago-oauth'
import { encryptSecret } from '@/lib/payments/encryption'
import { GET } from './route'

function callbackRequest(state: string) {
  return new NextRequest(`https://app.example.com/api/mercado-pago/callback?code=auth-code&state=${encodeURIComponent(state)}`)
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
    mocks.prisma.$transaction.mockImplementation(async (operation) => operation(mocks.prisma))
    mocks.prisma.mercadoPagoOAuthAttempt.findFirst.mockResolvedValue({
      id: 'attempt-1', verifierEncrypted: encryptSecret('verifier'),
    })
    mocks.prisma.mercadoPagoOAuthAttempt.updateMany.mockResolvedValue({ count: 1 })
    mocks.exchangeAuthorizationCode.mockResolvedValue({
      accessToken: 'access', refreshToken: 'refresh', providerAccountId: '12',
      expiresAt: new Date('2026-08-11T13:00:00.000Z'),
    })
  })

  it('rejects a state signed for another environment before token exchange', async () => {
    const state = createMercadoPagoOAuthState({
      businessId: 'business-1', environment: 'production', nonce: 'nonce',
      expiresAt: new Date('2026-08-11T12:10:00.000Z'),
    })
    const response = await GET(callbackRequest(state))
    expect(response.headers.get('location')).toContain('error=invalid_state')
    expect(mocks.exchangeAuthorizationCode).not.toHaveBeenCalled()
  })

  it('rejects a missing or already-consumed persisted attempt', async () => {
    const state = createMercadoPagoOAuthState({
      businessId: 'business-1', environment: 'sandbox', nonce: 'nonce',
      expiresAt: new Date('2026-08-11T12:10:00.000Z'),
    })
    mocks.prisma.mercadoPagoOAuthAttempt.findFirst.mockResolvedValue(null)
    const response = await GET(callbackRequest(state))
    expect(response.headers.get('location')).toContain('error=invalid_state')
    expect(mocks.exchangeAuthorizationCode).not.toHaveBeenCalled()
  })

  it('consumes the bound verifier once and writes only the selected environment', async () => {
    const state = createMercadoPagoOAuthState({
      businessId: 'business-1', environment: 'sandbox', nonce: 'nonce',
      expiresAt: new Date('2026-08-11T12:10:00.000Z'),
    })
    const response = await GET(callbackRequest(state))
    expect(mocks.exchangeAuthorizationCode).toHaveBeenCalledWith(expect.objectContaining({
      environment: 'sandbox', code: 'auth-code', codeVerifier: 'verifier',
    }))
    expect(mocks.prisma.paymentAccount.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { businessId_provider_environment: {
        businessId: 'business-1', provider: 'mercado_pago', environment: 'sandbox',
      } },
      create: expect.objectContaining({ providerAccountId: '12' }),
    }))
    expect(response.headers.get('location')).toContain('success=connected')
    expect(mocks.prisma.mercadoPagoOAuthAttempt.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'attempt-1', consumedAt: null, expiresAt: { gt: expect.any(Date) } },
    }))
  })

  it('allows two bounded concurrent starts to complete independently, then rejects replay', async () => {
    const stateOne = createMercadoPagoOAuthState({
      businessId: 'business-1', environment: 'sandbox', nonce: 'nonce-one',
      expiresAt: new Date('2026-08-11T12:10:00.000Z'),
    })
    const stateTwo = createMercadoPagoOAuthState({
      businessId: 'business-1', environment: 'sandbox', nonce: 'nonce-two',
      expiresAt: new Date('2026-08-11T12:10:00.000Z'),
    })
    mocks.prisma.mercadoPagoOAuthAttempt.findFirst
      .mockResolvedValueOnce({ id: 'attempt-1', verifierEncrypted: encryptSecret('verifier-one') })
      .mockResolvedValueOnce({ id: 'attempt-2', verifierEncrypted: encryptSecret('verifier-two') })
      .mockResolvedValueOnce(null)
    const first = await GET(callbackRequest(stateOne))
    const second = await GET(callbackRequest(stateTwo))
    const replay = await GET(callbackRequest(stateOne))
    expect(first.headers.get('location')).toContain('success=connected')
    expect(second.headers.get('location')).toContain('success=connected')
    expect(replay.headers.get('location')).toContain('error=invalid_state')
    expect(mocks.exchangeAuthorizationCode).toHaveBeenCalledTimes(2)
  })
})
