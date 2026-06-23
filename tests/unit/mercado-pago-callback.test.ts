import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import { createHmac, createHash } from 'crypto'

const originalEnv = { ...process.env }

const mockMpFetch = vi.fn()
vi.stubGlobal('fetch', mockMpFetch)

const mockPrisma = {
  businessUser: { findFirst: vi.fn() },
  business: { findUnique: vi.fn() },
  paymentAccount: { upsert: vi.fn() },
}

const mockSupabaseAuth = {
  getUser: vi.fn(),
}

vi.mock('@prisma/client', () => ({}))
vi.mock('@/lib/db', () => ({ prisma: mockPrisma }))
vi.mock('@/lib/payments/encryption', () => ({
  encryptSecret: vi.fn().mockReturnValue('encrypted-token'),
  decryptSecret: vi.fn(),
}))

vi.mock('@/lib/auth/middleware', () => ({
  createClient: vi.fn(),
}))

function setEnv(vars: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(vars)) {
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
}

function makeCallbackRequest(params: Record<string, string>): NextRequest {
  const url = new URL('http://localhost:3000/api/mercado-pago/callback')
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value)
  }
  return new NextRequest(url)
}

function createValidState(businessId: string): string {
  const key = 'test-encryption-key-for-mp!32b'
  // Mirror oauth-state.ts: the HMAC key is domain-separated, not the raw env key.
  const signingKey = createHash('sha256').update(`oauth-state-hmac:${key}`).digest()
  const expiresAt = Date.now() + 600000
  const stateValue = 'abc123'
  const payload = `${businessId}:${stateValue}:${expiresAt}`
  const sig = createHmac('sha256', signingKey).update(payload).digest('hex')
  return `${payload}:${sig}`
}

describe('Mercado Pago OAuth callback', () => {
  let GET: (req: NextRequest) => Promise<Response>

  beforeEach(async () => {
    setEnv({
      ENCRYPTION_KEY: 'test-encryption-key-for-mp!32b',
      MERCADO_PAGO_CLIENT_ID: 'test-client-id',
      MERCADO_PAGO_CLIENT_SECRET: 'test-client-secret',
      MERCADO_PAGO_REDIRECT_URI: 'http://localhost:3000/api/mercado-pago/callback',
      NODE_ENV: 'development',
    })

    vi.clearAllMocks()
    mockMpFetch.mockReset()
    vi.resetModules()

    const mod = await import('@/app/api/mercado-pago/callback/route')
    GET = mod.GET as unknown as (req: NextRequest) => Promise<Response>

    const { createClient } = await import('@/lib/auth/middleware')
    vi.mocked(createClient).mockReturnValue({
      auth: mockSupabaseAuth,
    } as any)
  })

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  it('redirects with error=invalid_state when state is expired', async () => {
    const state = createValidState('biz-1')
    const parts = state.split(':')
    parts[2] = String(Date.now() - 1000)
    const expiredState = parts.join(':')

    const req = makeCallbackRequest({ code: 'test-code', state: expiredState })
    const res = await GET(req)

    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toContain('error=invalid_state')
  })

  it('redirects with error=invalid_state when state has invalid signature', async () => {
    const state = 'biz-1:abc123:9999999999999:badsignature1234567890abcdef1234567890abcdef'

    const req = makeCallbackRequest({ code: 'test-code', state })
    const res = await GET(req)

    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toContain('error=invalid_state')
  })

  it('redirects with error=not_authenticated when no Supabase user', async () => {
    mockSupabaseAuth.getUser.mockResolvedValue({ data: { user: null } })

    const state = createValidState('biz-1')

    const req = makeCallbackRequest({ code: 'test-code', state })
    const res = await GET(req)

    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toContain('error=not_authenticated')
  })

  it('redirects with error=not_authorized when user has no business membership', async () => {
    mockSupabaseAuth.getUser.mockResolvedValue({ data: { user: { id: 'user-1', email: 'test@test.com' } } })
    mockPrisma.businessUser.findFirst.mockResolvedValue(null)

    const state = createValidState('biz-1')

    const req = makeCallbackRequest({ code: 'test-code', state })
    const res = await GET(req)

    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toContain('error=not_authorized')
    expect(mockPrisma.paymentAccount.upsert).not.toHaveBeenCalled()
  })

  it('does not create PaymentAccount when token exchange fails', async () => {
    mockSupabaseAuth.getUser.mockResolvedValue({ data: { user: { id: 'user-1', email: 'test@test.com' } } })
    mockPrisma.businessUser.findFirst.mockResolvedValue({ role: 'owner' })
    mockPrisma.business.findUnique.mockResolvedValue({ id: 'biz-1' })

    mockMpFetch.mockResolvedValue({
      ok: false,
      text: () => Promise.resolve('{"error":"invalid_grant"}'),
      json: () => Promise.resolve({}),
    })

    const state = createValidState('biz-1')

    const req = makeCallbackRequest({ code: 'test-code', state })
    const res = await GET(req)

    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toContain('error=token_exchange_failed')
    expect(mockPrisma.paymentAccount.upsert).not.toHaveBeenCalled()
  })
})
