import { afterEach, describe, expect, it, vi } from 'vitest'
import { GET } from '@/app/api/health/dependencies/route'

function request(secret?: string): Request {
  return new Request('http://localhost:3000/api/health/dependencies', {
    headers: secret ? { Authorization: `Bearer ${secret}` } : undefined,
  })
}

function setRequiredEnv(paymentProvider = 'mercado_pago') {
  vi.stubEnv('NODE_ENV', 'production')
  vi.stubEnv('CRON_SECRET', 'expected')
  vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://redis.example.com')
  vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'redis-token')
  vi.stubEnv('RESEND_API_KEY', 'resend-token')
  vi.stubEnv('PAYMENT_PROVIDER', paymentProvider)
  vi.stubEnv('MERCADO_PAGO_ACCESS_TOKEN', 'mp-token')
}

type ProviderOverrides = {
  redis?: Response
  resend?: Response
  mercadoPago?: Response
}

function providerResponse(url: string, overrides: ProviderOverrides = {}): Response {
  if (url.includes('redis.example.com')) {
    return overrides.redis
      ?? new Response(JSON.stringify({ result: 'PONG' }), { status: 200 })
  }
  if (url.includes('resend.com')) {
    return overrides.resend
      ?? new Response(JSON.stringify({ object: 'list', data: [] }), { status: 200 })
  }
  if (url.includes('mercadopago.com')) {
    return overrides.mercadoPago
      ?? new Response(JSON.stringify({ id: 123 }), { status: 200 })
  }
  throw new Error(`Unexpected health URL: ${url}`)
}

function mockProviders(overrides: ProviderOverrides = {}) {
  return vi.spyOn(global, 'fetch').mockImplementation(async input => (
    providerResponse(String(input), overrides)
  ))
}

describe('GET /api/health/dependencies', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it.each([
    ['missing header', undefined, 'expected'],
    ['wrong header', 'wrong', 'expected'],
    ['missing server secret', 'expected', ''],
  ])('fails closed for %s before running probes', async (_case, provided, expected) => {
    vi.stubEnv('CRON_SECRET', expected)
    const fetchMock = vi.spyOn(global, 'fetch')

    const response = await GET(request(provided))

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'Unauthorized' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns only sanitized states when required dependencies are healthy', async () => {
    setRequiredEnv()
    mockProviders()

    const response = await GET(request('expected'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({
      status: 'ok',
      checks: { redis: 'up', resend: 'up', mercadoPago: 'up' },
    })
    expect(Object.keys(body)).toEqual(['status', 'checks', 'timestamp'])
    expect(Number.isNaN(Date.parse(body.timestamp))).toBe(false)
  })

  it('starts all required probes before awaiting their responses', async () => {
    setRequiredEnv()
    const started: string[] = []
    let release: (() => void) | undefined
    const gate = new Promise<void>(resolve => {
      release = resolve
    })
    vi.spyOn(global, 'fetch').mockImplementation(async input => {
      const url = String(input)
      started.push(url)
      if (started.length === 3) release?.()
      await gate
      return providerResponse(url)
    })

    const response = await GET(request('expected'))

    expect(response.status).toBe(200)
    expect(started).toHaveLength(3)
  })

  it('returns 503 without leaking a provider rejection body', async () => {
    setRequiredEnv()
    mockProviders({
      resend: new Response('invalid-key-private-detail', { status: 401 }),
    })

    const response = await GET(request('expected'))
    const body = await response.text()

    expect(response.status).toBe(503)
    expect(body).toContain('"resend":"down"')
    expect(body).not.toContain('invalid-key-private-detail')
  })

  it('marks Mercado Pago not_required for manual payments', async () => {
    setRequiredEnv('manual')
    const fetchMock = mockProviders()

    const response = await GET(request('expected'))

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      status: 'ok',
      checks: { redis: 'up', resend: 'up', mercadoPago: 'not_required' },
    })
    expect(fetchMock.mock.calls.every(([url]) => (
      !String(url).includes('mercadopago.com')
    ))).toBe(true)
  })

  it.each([
    ['Resend', 'RESEND_API_KEY', 'resend'],
    ['Mercado Pago', 'MERCADO_PAGO_ACCESS_TOKEN', 'mercadoPago'],
  ])('degrades when required %s credentials are absent', async (
    _name,
    envKey,
    checkKey,
  ) => {
    setRequiredEnv()
    vi.stubEnv(envKey, '')
    mockProviders()

    const response = await GET(request('expected'))
    const body = await response.json()

    expect(response.status).toBe(503)
    expect(body.status).toBe('degraded')
    expect(body.checks[checkKey]).toBe('not_configured')
  })

  it('degrades OAuth-only Mercado Pago mode without the required global token', async () => {
    setRequiredEnv()
    vi.stubEnv('PAYMENT_PROVIDER', '')
    vi.stubEnv('MERCADO_PAGO_CLIENT_ID', 'client-id')
    vi.stubEnv('MERCADO_PAGO_CLIENT_SECRET', 'client-secret')
    vi.stubEnv('MERCADO_PAGO_REDIRECT_URI', 'https://app.example.com/callback')
    vi.stubEnv('MERCADO_PAGO_ACCESS_TOKEN', '')
    mockProviders()

    const response = await GET(request('expected'))
    const body = await response.json()

    expect(response.status).toBe(503)
    expect(body).toMatchObject({
      status: 'degraded',
      checks: { mercadoPago: 'not_configured' },
    })
  })
})
