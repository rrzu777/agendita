import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createHmac } from 'crypto'

const mockMpFetch = vi.fn()
vi.stubGlobal('fetch', mockMpFetch)

const mockPrisma = {
  paymentAccount: {
    findFirst: vi.fn(),
    upsert: vi.fn(),
    update: vi.fn(),
  },
  businessUser: { findFirst: vi.fn() },
  business: { findUnique: vi.fn() },
}
vi.mock('@/lib/db', () => ({ prisma: mockPrisma }))

vi.mock('@/lib/auth/server', () => ({
  requireUser: vi.fn().mockResolvedValue({ id: 'user-1' }),
  requireBusiness: vi.fn().mockResolvedValue({ userId: 'user-1', businessId: 'biz-1' }),
}))

vi.mock('@/lib/payments/encryption', () => ({
  encryptSecret: vi.fn().mockReturnValue('encrypted-token'),
  decryptSecret: vi.fn().mockReturnValue('decrypted-token'),
}))

vi.mock('@/lib/payments/oauth-state', () => ({
  signState: vi.fn(),
  verifyStateSignature: vi.fn(),
}))

const mockSupabaseAuth = { getUser: vi.fn() }
vi.mock('@/lib/auth/middleware', () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: mockSupabaseAuth,
  }),
}))

const originalEnv = { ...process.env }

function setEnv(vars: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(vars)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
}

function createValidState(businessId: string, expirationMs?: number): string {
  const key = process.env.ENCRYPTION_KEY || 'test-encryption-key-32bytes!!'
  const stateValue = 'state-abc-123'
  const expiresAt = expirationMs ?? Date.now() + 600000
  const payload = `${businessId}:${stateValue}:${expiresAt}`
  const sig = createHmac('sha256', key).update(payload).digest('hex')
  return `${payload}:${sig}`
}

describe('Mercado Pago OAuth', () => {
  beforeEach(() => {
    setEnv({
      NODE_ENV: 'development',
      ENCRYPTION_KEY: 'test-encryption-key-32bytes!!',
      MERCADO_PAGO_CLIENT_ID: 'test-client-id',
      MERCADO_PAGO_CLIENT_SECRET: 'test-client-secret',
      MERCADO_PAGO_REDIRECT_URI: 'https://app.example.com/api/mercado-pago/callback',
    })
    vi.clearAllMocks()
  })

  afterEach(() => {
    process.env = { ...originalEnv }
    vi.resetModules()
  })

  describe('initiateMercadoPagoOAuth', () => {
    it('builds redirect URL with required MP OAuth params', async () => {
      const { initiateMercadoPagoOAuth } = await import('@/server/actions/mercado-pago-connect')
      const result = await initiateMercadoPagoOAuth()
      expect(result.redirectUrl).toBeDefined()
      const url = new URL(result.redirectUrl)
      expect(url.origin).toBe('https://auth.mercadopago.cl')
      expect(url.pathname).toBe('/authorization')
      expect(url.searchParams.get('client_id')).toBe('test-client-id')
      expect(url.searchParams.get('response_type')).toBe('code')
      expect(url.searchParams.get('platform_id')).toBe('mp')
      expect(url.searchParams.get('redirect_uri')).toBe('https://app.example.com/api/mercado-pago/callback')
    })

    it('includes signed state containing businessId and expiration', async () => {
      const { initiateMercadoPagoOAuth } = await import('@/server/actions/mercado-pago-connect')
      const result = await initiateMercadoPagoOAuth()
      const url = new URL(result.redirectUrl)
      const state = url.searchParams.get('state')
      expect(state).toBeDefined()
      const parts = state!.split(':')
      expect(parts.length).toBe(4)
      expect(parts[0]).toBe('biz-1')
      expect(parseInt(parts[2], 10)).toBeGreaterThan(Date.now())
    })

    it('throws when MERCADO_PAGO_CLIENT_ID is not configured', async () => {
      setEnv({ MERCADO_PAGO_CLIENT_ID: undefined })
      const { initiateMercadoPagoOAuth } = await import('@/server/actions/mercado-pago-connect')
      await expect(initiateMercadoPagoOAuth()).rejects.toThrow(/CLIENT_ID/)
    })

    it('throws when MERCADO_PAGO_REDIRECT_URI is not configured', async () => {
      setEnv({ MERCADO_PAGO_REDIRECT_URI: undefined })
      const { initiateMercadoPagoOAuth } = await import('@/server/actions/mercado-pago-connect')
      await expect(initiateMercadoPagoOAuth()).rejects.toThrow(/REDIRECT_URI/)
    })
  })

  describe('OAuth callback', () => {
    // We reset modules before each test and re-apply mocks so that mocks
    // are fresh and the route picks up the mock implementations.
    beforeEach(() => {
      mockSupabaseAuth.getUser.mockResolvedValue({
        data: { user: { id: 'user-1', email: 'test@test.com' } },
      })
      mockPrisma.businessUser.findFirst.mockResolvedValue({ role: 'owner' })
      mockPrisma.business.findUnique.mockResolvedValue({ id: 'biz-1' })
      vi.clearAllMocks()
    })

    async function importRoute(enableVerifyMock = true) {
      vi.resetModules()
      // Re-apply per-test mocks so route picks them up
      const { createClient } = await import('@/lib/auth/middleware')
      vi.mocked(createClient).mockResolvedValue({
        auth: mockSupabaseAuth,
      })
      if (enableVerifyMock) {
        const { verifyStateSignature } = await import('@/lib/payments/oauth-state')
        vi.mocked(verifyStateSignature).mockReturnValue(true)
      }
      const mod = await import('@/app/api/mercado-pago/callback/route')
      return mod
    }

    it('redirects with error=invalid_state when state signature is invalid', async () => {
      // For this test, do NOT apply the verifyStateSignature mock override
      const mod = await importRoute(false)
      const GET = mod.GET as unknown as (req: Request) => Promise<Response>
      // State with invalid (non-hex) signature so verifyStateSignature returns false
      const req = new Request(
        `http://localhost/api/mercado-pago/callback?code=test-code&state=biz-1:state:9999999999:NOT_A_VALID_SIGNATURE_HEX_STRING_THAT_WONT_VERIFY`,
      )
      const res = await GET(req)
      expect(res.status).toBe(307)
      expect(res.headers.get('location')).toContain('error=invalid_state')
    })

    it('redirects with error=invalid_callback when code is missing', async () => {
      mockMpFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({ access_token: 'tok' }) })
      const mod = await importRoute()
      const GET = mod.GET as unknown as (req: Request) => Promise<Response>
      const req = new Request(
        `http://localhost/api/mercado-pago/callback?state=${encodeURIComponent(createValidState('biz-1'))}`,
      )
      const res = await GET(req)
      expect(res.status).toBe(307)
      expect(res.headers.get('location')).toContain('error=invalid_callback')
    })

    it('redirects with error=token_exchange_failed when MP token API fails', async () => {
      mockMpFetch.mockResolvedValue({ ok: false, text: () => Promise.resolve('invalid_grant') })
      const mod = await importRoute()
      const GET = mod.GET as unknown as (req: Request) => Promise<Response>
      const req = new Request(
        `http://localhost/api/mercado-pago/callback?code=test-code&state=${encodeURIComponent(createValidState('biz-1'))}`,
      )
      const res = await GET(req)
      expect(res.status).toBe(307)
      expect(res.headers.get('location')).toContain('error=token_exchange_failed')
      expect(mockPrisma.paymentAccount.upsert).not.toHaveBeenCalled()
    })

    it('creates PaymentAccount on successful token exchange', async () => {
      mockMpFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            access_token: 'mp-access-token-123',
            refresh_token: 'mp-refresh-token-456',
            user_id: 123456,
            expires_in: 21600,
          }),
      })
      mockPrisma.paymentAccount.upsert.mockResolvedValue({
        id: 'pa-1', businessId: 'biz-1', provider: 'mercado_pago', status: 'connected',
      })
      const mod = await importRoute()
      const GET = mod.GET as unknown as (req: Request) => Promise<Response>
      const req = new Request(
        `http://localhost/api/mercado-pago/callback?code=valid-code&state=${encodeURIComponent(createValidState('biz-1'))}`,
      )
      const res = await GET(req)
      expect(res.status).toBe(307)
      expect(res.headers.get('location')).toContain('success=connected')
      expect(mockPrisma.paymentAccount.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { businessId_provider: { businessId: 'biz-1', provider: 'mercado_pago' } },
          create: expect.objectContaining({
            businessId: 'biz-1', provider: 'mercado_pago',
            accessTokenEncrypted: 'encrypted-token', status: 'connected',
          }),
        }),
      )
    })

    it('passes network error through as error=unexpected', async () => {
      mockMpFetch.mockRejectedValue(new Error('ECONNRESET'))
      const mod = await importRoute()
      const GET = mod.GET as unknown as (req: Request) => Promise<Response>
      const req = new Request(
        `http://localhost/api/mercado-pago/callback?code=net-err&state=${encodeURIComponent(createValidState('biz-1'))}`,
      )
      const res = await GET(req)
      expect(res.status).toBe(307)
      expect(res.headers.get('location')).toContain('error=unexpected')
    })
  })

  describe('disconnectMercadoPagoConnection', () => {
    it('sets PaymentAccount status to disconnected and keeps the record', async () => {
      mockPrisma.paymentAccount.findFirst.mockResolvedValue({
        id: 'pa-1',
        businessId: 'biz-1',
        provider: 'mercado_pago',
        status: 'connected',
        accessTokenEncrypted: 'encrypted-token',
      })
      mockPrisma.paymentAccount.update.mockResolvedValue({
        id: 'pa-1',
        businessId: 'biz-1',
        provider: 'mercado_pago',
        status: 'disconnected',
        disconnectedAt: new Date(),
      })
      const { disconnectMercadoPagoConnection } = await import('@/server/actions/mercado-pago-connect')
      const result = await disconnectMercadoPagoConnection()
      expect(result.disconnected).toBe(true)
      expect(mockPrisma.paymentAccount.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'pa-1' },
          data: expect.objectContaining({
            status: 'disconnected',
            disconnectedAt: expect.any(Date),
          }),
        }),
      )
    })

    it('throws when no PaymentAccount is connected', async () => {
      mockPrisma.paymentAccount.findFirst.mockResolvedValue(null)
      const { disconnectMercadoPagoConnection } = await import('@/server/actions/mercado-pago-connect')
      await expect(disconnectMercadoPagoConnection()).rejects.toThrow('No hay cuenta')
    })
  })

  describe('getPaymentAccountStatus', () => {
    it('returns account with correct fields', async () => {
      const mockAccount = {
        id: 'pa-1',
        status: 'connected' as const,
        providerAccountId: '123456',
        connectedAt: new Date(),
        disconnectedAt: null,
        expiresAt: new Date(),
      }
      mockPrisma.paymentAccount.findFirst.mockResolvedValue(mockAccount)
      const { getPaymentAccountStatus } = await import('@/server/actions/mercado-pago-connect')
      const result = await getPaymentAccountStatus()
      expect(result).toEqual(mockAccount)
    })

    it('returns null when no account exists', async () => {
      mockPrisma.paymentAccount.findFirst.mockResolvedValue(null)
      const { getPaymentAccountStatus } = await import('@/server/actions/mercado-pago-connect')
      const result = await getPaymentAccountStatus()
      expect(result).toBeNull()
    })
  })
})