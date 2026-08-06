import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { queryRawMock } = vi.hoisted(() => ({
  queryRawMock: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  prisma: {
    $queryRaw: queryRawMock,
  },
}))

import { GET } from '@/app/api/health/route'

function setProductionDependencyEnv() {
  vi.stubEnv('NODE_ENV', 'production')
  vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://redis.example.com')
  vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'redis-token')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://supabase.example.com')
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'supabase-key')
}

function unsetExternalDependencyEnv() {
  vi.stubEnv('UPSTASH_REDIS_REST_URL', '')
  vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', '')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '')
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', '')
}

function mockHealthFetch(redisResult: unknown = 'PONG') {
  return vi.spyOn(global, 'fetch').mockImplementation(async input => {
    const url = String(input)
    if (url.includes('redis.example.com')) {
      return new Response(JSON.stringify({ result: redisResult }), { status: 200 })
    }
    if (url.includes('supabase.example.com')) {
      return new Response('{}', { status: 200 })
    }
    throw new Error(`Unexpected health URL: ${url}`)
  })
}

describe('GET /api/health', () => {
  beforeEach(() => {
    queryRawMock.mockReset()
    queryRawMock.mockResolvedValue([{ value: 1 }])
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('returns 200 when all production dependencies are operational', async () => {
    setProductionDependencyEnv()
    mockHealthFetch()

    const response = await GET()
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({
      status: 'ok',
      checks: { db: 'up', redis: 'up', supabase: 'up' },
    })
    expect(Object.keys(body)).toEqual(['status', 'checks', 'timestamp'])
    expect(Number.isNaN(Date.parse(body.timestamp))).toBe(false)
  })

  it('keeps not_configured in detail but degrades required production dependencies', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    unsetExternalDependencyEnv()

    const response = await GET()

    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({
      status: 'degraded',
      checks: {
        db: 'up',
        redis: 'not_configured',
        supabase: 'not_configured',
      },
    })
  })

  it('allows unconfigured optional dependencies outside production', async () => {
    vi.stubEnv('NODE_ENV', 'test')
    unsetExternalDependencyEnv()

    const response = await GET()

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      status: 'ok',
      checks: {
        db: 'up',
        redis: 'not_configured',
        supabase: 'not_configured',
      },
    })
  })

  it('degrades when EVAL does not return PONG', async () => {
    setProductionDependencyEnv()
    mockHealthFetch('NOPE')

    const response = await GET()

    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({
      status: 'degraded',
      checks: { db: 'up', redis: 'down', supabase: 'up' },
    })
  })

  it('degrades without serializing a database error', async () => {
    setProductionDependencyEnv()
    queryRawMock.mockRejectedValue(new Error('private-db-detail'))
    mockHealthFetch()

    const response = await GET()
    const body = await response.text()

    expect(response.status).toBe(503)
    expect(body).toContain('"db":"down"')
    expect(body).not.toContain('private-db-detail')
  })
})
