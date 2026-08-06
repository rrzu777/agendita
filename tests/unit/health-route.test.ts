import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { queryRawMock } = vi.hoisted(() => ({ queryRawMock: vi.fn() }))

vi.mock('@/lib/db', () => ({
  prisma: { $queryRaw: queryRawMock },
}))

import { GET } from '@/app/api/health/route'

describe('GET /api/health', () => {
  const fetchMock = vi.fn()
  let errorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    queryRawMock.mockReset().mockResolvedValue([{ ok: 1 }])
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
    vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://test.upstash.io/')
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'test-token')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '')
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', '')
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('probes Redis with a non-mutating EVAL command', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ result: 1 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    )

    const response = await GET()

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      status: 'ok',
      checks: { db: 'up', redis: 'up', supabase: 'not_configured' },
    })
    expect(fetchMock).toHaveBeenCalledWith(
      'https://test.upstash.io',
      expect.objectContaining({
        method: 'POST',
        headers: {
          Authorization: 'Bearer test-token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(['EVAL', 'return 1', 0]),
      })
    )
  })

  it.each([
    {
      label: 'an unexpected result',
      redisResponse: new Response(JSON.stringify({ result: 'PONG' }), { status: 200 }),
      expectedLog: { reason: 'invalid_response' },
    },
    {
      label: 'invalid JSON',
      redisResponse: new Response('not-json', { status: 200 }),
      expectedLog: { reason: 'invalid_response' },
    },
    {
      label: 'an unauthorized response',
      redisResponse: new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 }),
      expectedLog: { reason: 'http_status', status: 401 },
    },
  ])('marks Redis down for $label', async ({ redisResponse, expectedLog }) => {
    fetchMock.mockResolvedValue(redisResponse)

    const response = await GET()
    const payload = await response.json()

    expect(response.status).toBe(503)
    expect(payload.checks.redis).toBe('down')
    expect(errorSpy).toHaveBeenCalledWith('[Health] Redis check failed', expectedLog)
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain('test-token')
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain('test.upstash.io')
  })

  it('marks partial Redis configuration down without fetching', async () => {
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', '')

    const response = await GET()

    expect(response.status).toBe(503)
    expect((await response.json()).checks.redis).toBe('down')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(errorSpy).toHaveBeenCalledWith('[Health] Redis check failed', {
      reason: 'partial_configuration',
    })
  })

  it('marks Redis down when fetch rejects', async () => {
    fetchMock.mockRejectedValue(new DOMException('timed out', 'TimeoutError'))

    const response = await GET()

    expect(response.status).toBe(503)
    expect((await response.json()).checks.redis).toBe('down')
    expect(errorSpy).toHaveBeenCalledWith('[Health] Redis check failed', {
      reason: 'timeout_or_network',
    })
  })

  it('keeps Redis not configured when URL and token are absent', async () => {
    vi.stubEnv('UPSTASH_REDIS_REST_URL', '')
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', '')

    const response = await GET()

    expect(response.status).toBe(200)
    expect((await response.json()).checks.redis).toBe('not_configured')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(errorSpy).not.toHaveBeenCalled()
  })
})
