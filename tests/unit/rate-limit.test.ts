import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  blockIp,
  unblockIp,
  getBlockedIps,
  RATE_LIMITS,
  resetLimiter,
} from '@/lib/rate-limit'
import { MemoryRateLimiter, RedisRateLimiter } from '@/lib/rate-limit'

describe('block list', () => {
  afterEach(() => {
    const blocked = getBlockedIps()
    blocked.forEach(ip => unblockIp(ip))
  })

  it('blockIp adds IP to block list', () => {
    blockIp('1.2.3.4')
    expect(getBlockedIps().has('1.2.3.4')).toBe(true)
  })

  it('unblockIp removes IP from block list', () => {
    blockIp('1.2.3.4')
    unblockIp('1.2.3.4')
    expect(getBlockedIps().has('1.2.3.4')).toBe(false)
  })

  it('blocked IP check is case-sensitive', () => {
    blockIp('1.2.3.4')
    expect(getBlockedIps().has('1.2.3.4')).toBe(true)
    expect(getBlockedIps().has('1.2.3.5')).toBe(false)
  })
})

describe('RATE_LIMITS config', () => {
  it('create-booking has correct limits', () => {
    expect(RATE_LIMITS['create-booking'].maxRequests).toBe(20)
    expect(RATE_LIMITS['create-booking'].windowMs).toBe(60_000)
  })

  it('confirm-payment has correct limits', () => {
    expect(RATE_LIMITS['confirm-payment'].maxRequests).toBe(30)
    expect(RATE_LIMITS['confirm-payment'].windowMs).toBe(60_000)
  })

  it('default fallback exists', () => {
    expect(RATE_LIMITS['default']).toBeDefined()
    expect(RATE_LIMITS['default'].maxRequests).toBe(60)
  })
})

describe('MemoryRateLimiter', () => {
  let limiter: MemoryRateLimiter

  beforeEach(() => {
    limiter = new MemoryRateLimiter()
  })

  it('allows requests within limit', async () => {
    const result = await limiter.check('test-action', 5, 60_000, { ip: '1.1.1.1' })
    expect(result.success).toBe(true)
    expect(result.remaining).toBe(4)
  })

  it('blocks when limit exceeded', async () => {
    const result = await limiter.check('test-action', 2, 60_000, { ip: '2.2.2.2' })
    expect(result.success).toBe(true)
    expect(result.remaining).toBe(1)

    const second = await limiter.check('test-action', 2, 60_000, { ip: '2.2.2.2' })
    expect(second.success).toBe(true)
    expect(second.remaining).toBe(0)

    const third = await limiter.check('test-action', 2, 60_000, { ip: '2.2.2.2' })
    expect(third.success).toBe(false)
    expect(third.remaining).toBe(0)
  })

  it('separate IPs have independent limits', async () => {
    await limiter.check('action', 2, 60_000, { ip: '10.0.0.1' })
    await limiter.check('action', 2, 60_000, { ip: '10.0.0.1' })

    const differentIp = await limiter.check('action', 2, 60_000, { ip: '10.0.0.2' })
    expect(differentIp.success).toBe(true)
    expect(differentIp.remaining).toBe(1)
  })

  it('shares one target-global bucket across IPs and isolates unrelated targets', async () => {
    await limiter.check('push-subscribe-target', 1, 60_000, {
      ip: '10.0.0.1', keyMode: 'target', targetId: 'booking-1',
    })

    const sameTarget = await limiter.check('push-subscribe-target', 1, 60_000, {
      ip: '10.0.0.2', keyMode: 'target', targetId: 'booking-1',
    })
    const otherTarget = await limiter.check('push-subscribe-target', 1, 60_000, {
      ip: '10.0.0.1', keyMode: 'target', targetId: 'booking-2',
    })

    expect(sameTarget.success).toBe(false)
    expect(otherTarget.success).toBe(true)
  })

  it('clears store correctly', () => {
    limiter.clear()
    expect(() => limiter.clear()).not.toThrow()
  })
})

describe('RedisRateLimiter target keys', () => {
  it('sends only a hashed target and excludes both raw target and IP', async () => {
    const rawTarget = 'guest:business-1:customer-1:booking-1'
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ result: [1, 9, 60] }), { status: 200 }),
    )
    vi.stubGlobal('fetch', fetchMock)

    try {
      const limiter = new RedisRateLimiter('https://redis.example.test', 'token')
      await limiter.check('push-subscribe-target', 10, 60_000, {
        ip: '203.0.113.42',
        keyMode: 'target',
        targetId: rawTarget,
      })

      const requestBody = String(fetchMock.mock.calls[0]?.[1]?.body)
      expect(requestBody).not.toContain(rawTarget)
      expect(requestBody).not.toContain('203.0.113.42')
      expect(requestBody).toMatch(/push-subscribe-target:t:[a-f0-9]{64}/)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('fail-closed behavior in production', () => {
  // Test that when NODE_ENV=production and Upstash vars are missing,
  // checkRateLimit returns blocked (fail-closed). This mirrors the
  // FailClosedRateLimiter logic in createRateLimiter().
  it('blocks all requests when NODE_ENV=production and UPSTASH vars are absent', async () => {
    vi.stubEnv('NODE_ENV', 'production')

    const origUpstashUrl = process.env.UPSTASH_REDIS_REST_URL
    const origUpstashToken = process.env.UPSTASH_REDIS_REST_TOKEN

    try {
      delete process.env.UPSTASH_REDIS_REST_URL
      delete process.env.UPSTASH_REDIS_REST_TOKEN

      resetLimiter()

      const { checkRateLimit } = await import('@/lib/rate-limit')
      const result = await checkRateLimit('test-action', 10, 60_000, { ip: '1.1.1.1' })

      expect(result.success).toBe(false)
      expect(result.remaining).toBe(0)
    } finally {
      if (origUpstashUrl !== undefined) process.env.UPSTASH_REDIS_REST_URL = origUpstashUrl
      else delete process.env.UPSTASH_REDIS_REST_URL
      if (origUpstashToken !== undefined) process.env.UPSTASH_REDIS_REST_TOKEN = origUpstashToken
      else delete process.env.UPSTASH_REDIS_REST_TOKEN

      resetLimiter()
      vi.unstubAllEnvs()
    }
  })

  it('uses RedisRateLimiter and fails closed when fetch fails', async () => {
    vi.stubEnv('NODE_ENV', 'production')

    const origUpstashUrl = process.env.UPSTASH_REDIS_REST_URL
    const origUpstashToken = process.env.UPSTASH_REDIS_REST_TOKEN

    try {
      process.env.UPSTASH_REDIS_REST_URL = 'https://test.upstash.io'
      process.env.UPSTASH_REDIS_REST_TOKEN = 'test-token'

      resetLimiter()

      const fetchMock = vi.fn().mockRejectedValue(new Error('Network unreachable'))
      vi.stubGlobal('fetch', fetchMock)

      const { checkRateLimit } = await import('@/lib/rate-limit')
      const result = await checkRateLimit('test-action', 10, 60_000, { ip: '1.1.1.1' })

      expect(result.success).toBe(false)
      expect(result.remaining).toBe(0)
      expect(fetchMock).toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
      if (origUpstashUrl !== undefined) process.env.UPSTASH_REDIS_REST_URL = origUpstashUrl
      else delete process.env.UPSTASH_REDIS_REST_URL
      if (origUpstashToken !== undefined) process.env.UPSTASH_REDIS_REST_TOKEN = origUpstashToken
      else delete process.env.UPSTASH_REDIS_REST_TOKEN

      resetLimiter()
      vi.unstubAllEnvs()
    }
  })
})
