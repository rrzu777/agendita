import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const originalEnv = { ...process.env }

function setEnv(vars: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(vars)) {
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
}

afterEach(() => {
  process.env = { ...originalEnv }
  vi.resetModules()
})

// ─── Logger tests ─────────────────────────────────────────────────────────────

describe('logger', () => {
  let output: string[] = []
  let errorOutput: string[] = []

  beforeEach(() => {
    output = []
    errorOutput = []
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      output.push(args.join(' '))
    })
    vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
      output.push(args.join(' '))
    })
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      errorOutput.push(args.join(' '))
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('logs booking.created with redacted email', async () => {
    const { logger } = await import('@/lib/logger')
    logger.booking.created('booking-1', 'biz-1', 'maria@mail.com')
    const entry = JSON.parse(output[0])
    expect(entry.event).toBe('booking.created')
    expect(entry.bookingId).toBe('booking-1')
    expect(entry.businessId).toBe('biz-1')
    expect(entry.metadata?.customerEmail).toBe('[REDACTED]')
  })

  it('logs payment.initiated', async () => {
    const { logger } = await import('@/lib/logger')
    logger.payment.initiated('payment-1', 'booking-1', 'biz-1')
    const entry = JSON.parse(output[0])
    expect(entry.event).toBe('payment.initiated')
    expect(entry.paymentId).toBe('payment-1')
    expect(entry.bookingId).toBe('booking-1')
    expect(entry.businessId).toBe('biz-1')
  })

  it('logs payment.approved', async () => {
    const { logger } = await import('@/lib/logger')
    logger.payment.approved('payment-1', 'booking-1', 'biz-1')
    const entry = JSON.parse(output[0])
    expect(entry.event).toBe('payment.approved')
  })

  it('logs payment.failed', async () => {
    const { logger } = await import('@/lib/logger')
    logger.payment.failed('payment-1', 'booking-1', 'biz-1', 'amount mismatch')
    const entry = JSON.parse(output[0])
    expect(entry.event).toBe('payment.failed')
    expect(entry.metadata?.reason).toBe('amount mismatch')
  })

  it('logs webhook.received and webhook.rejected', async () => {
    const { logger } = await import('@/lib/logger')
    logger.webhook.received('mercado_pago', 'req-123')
    let entry = JSON.parse(output[0])
    expect(entry.event).toBe('webhook.received')
    expect(entry.requestId).toBe('req-123')

    logger.webhook.rejected('mercado_pago', 'Invalid signature', 'req-123')
    entry = JSON.parse(output[1])
    expect(entry.event).toBe('webhook.rejected')
    expect(entry.metadata?.reason).toBe('Invalid signature')
  })

  it('logs auth.failure', async () => {
    const { logger } = await import('@/lib/logger')
    logger.auth.failure('no-session', 'req-456', 'user-1')
    const entry = JSON.parse(output[0])
    expect(entry.event).toBe('auth.failure')
    expect(entry.userId).toBe('user-1')
  })

  it('logs rate_limit.blocked', async () => {
    const { logger } = await import('@/lib/logger')
    logger.rateLimit.blocked('create-booking', '1.2.3.4', 'biz-1')
    const entry = JSON.parse(output[0])
    expect(entry.event).toBe('rate_limit.blocked')
    expect(entry.metadata?.action).toBe('create-booking')
    expect(entry.metadata?.ip).toBe('1.2.3.4')
  })

  describe('secret redaction', () => {
    it('redacts token field', async () => {
      const { logger } = await import('@/lib/logger')
      logger.info('test', 'message', { metadata: { token: 'secret-token' } })
      const entry = JSON.parse(output[0])
      expect(entry.metadata?.token).toBe('[REDACTED]')
    })

    it('redacts authorization field', async () => {
      const { logger } = await import('@/lib/logger')
      logger.info('test', 'message', { metadata: { authorization: 'Bearer secret' } })
      const entry = JSON.parse(output[0])
      expect(entry.metadata?.authorization).toBe('[REDACTED]')
    })

    it('redacts rawPayload field', async () => {
      const { logger } = await import('@/lib/logger')
      logger.info('test', 'message', { metadata: { rawPayload: { id: 1 } } })
      const entry = JSON.parse(output[0])
      expect(entry.metadata?.rawPayload).toBe('[REDACTED]')
    })

    it('redacts signature field', async () => {
      const { logger } = await import('@/lib/logger')
      logger.info('test', 'message', { metadata: { signature: 'sig123' } })
      const entry = JSON.parse(output[0])
      expect(entry.metadata?.signature).toBe('[REDACTED]')
    })

    it('partially redacts email addresses', async () => {
      const { logger } = await import('@/lib/logger')
      logger.info('test', 'message', { metadata: { email: 'test@mail.com' } })
      const entry = JSON.parse(output[0])
      // Should redact to first 2 chars
      expect(entry.metadata?.email).toBe('te***@mail.com')
    })

    it('does not redact non-email strings', async () => {
      const { logger } = await import('@/lib/logger')
      logger.info('test', 'message', { metadata: { description: 'A message' } })
      const entry = JSON.parse(output[0])
      expect(entry.metadata?.description).toBe('A message')
    })

    it('does not redact short email-like strings', async () => {
      const { logger } = await import('@/lib/logger')
      logger.info('test', 'message', { metadata: { contact: 'a@b' } })
      const entry = JSON.parse(output[0])
      expect(entry.metadata?.contact).toBe('a@b')
    })
  })
})

// ─── Rate limiter tests ──────────────────────────────────────────────────────

describe('RateLimiter', () => {
  let fetchMock: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    fetchMock = vi.spyOn(global, 'fetch')
  })

  afterEach(() => {
    fetchMock.mockRestore()
    vi.restoreAllMocks()
  })

  describe('MemoryRateLimiter', () => {
    it('allows requests under the limit', async () => {
      const { MemoryRateLimiter } = await import('@/lib/rate-limit')
      const limiter = new MemoryRateLimiter()
      const result = await limiter.check('test', 5, 60000)
      expect(result.success).toBe(true)
      expect(result.remaining).toBe(4)
    })

    it('blocks requests over the limit', async () => {
      const { MemoryRateLimiter, resetLimiter } = await import('@/lib/rate-limit')
      resetLimiter()
      const limiter = new MemoryRateLimiter()
      for (let i = 0; i < 5; i++) {
        await limiter.check('test-limit', 5, 60000)
      }
      const result = await limiter.check('test-limit', 5, 60000)
      expect(result.success).toBe(false)
      expect(result.remaining).toBe(0)
    })

    it('keys include action and ip', async () => {
      const { MemoryRateLimiter, resetLimiter } = await import('@/lib/rate-limit')
      resetLimiter()
      const limiter = new MemoryRateLimiter()
      // First call for action-a with ip=1.1.1.1
      await limiter.check('action-a', 10, 60000, { ip: '1.1.1.1' })
      // First call for action-b with ip=2.2.2.2
      await limiter.check('action-b', 10, 60000, { ip: '2.2.2.2' })
      // Second call for action-a with ip=1.1.1.1 — different action gets own count
      const resultA = await limiter.check('action-a', 10, 60000, { ip: '1.1.1.1' })
      expect(resultA.remaining).toBe(8)
      // action-b count still 1
      const resultB = await limiter.check('action-b', 10, 60000, { ip: '2.2.2.2' })
      expect(resultB.remaining).toBe(8)
    })

    it('blocks cross-IP independently', async () => {
      const { MemoryRateLimiter, resetLimiter } = await import('@/lib/rate-limit')
      resetLimiter()
      const limiter = new MemoryRateLimiter()
      for (let i = 0; i < 3; i++) {
        await limiter.check('action', 3, 60000, { ip: '1.1.1.1' })
      }
      const blocked = await limiter.check('action', 3, 60000, { ip: '1.1.1.1' })
      expect(blocked.success).toBe(false)
      const otherIp = await limiter.check('action', 3, 60000, { ip: '2.2.2.2' })
      expect(otherIp.success).toBe(true)
    })
  })

  describe('RedisRateLimiter', () => {
    it('allows request when Redis returns allowed', async () => {
      const { RedisRateLimiter } = await import('@/lib/rate-limit')
      const limiter = new RedisRateLimiter('https://test.upstash.io', 'token')

      // Upstash REST response is wrapped in {result: ...}
      fetchMock.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ result: [1, 9, 60] }),
      } as Response)

      const result = await limiter.check('create-booking', 10, 60000, { ip: '1.2.3.4' })
      expect(result.success).toBe(true)
      expect(result.remaining).toBe(9)
    })

    it('blocks request when Redis returns limit exceeded', async () => {
      const { RedisRateLimiter } = await import('@/lib/rate-limit')
      const limiter = new RedisRateLimiter('https://test.upstash.io', 'token')

      // Upstash REST response is wrapped in {result: ...}
      fetchMock.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ result: [0, 0, 45] }),
      } as Response)

      const result = await limiter.check('create-booking', 10, 60000, { ip: '1.2.3.4' })
      expect(result.success).toBe(false)
      expect(result.remaining).toBe(0)
    })

    it('fails closed when Redis is unreachable', async () => {
      const { RedisRateLimiter } = await import('@/lib/rate-limit')
      const limiter = new RedisRateLimiter('https://test.upstash.io', 'token')

      fetchMock.mockRejectedValue(new Error('Network error'))

      const result = await limiter.check('create-booking', 10, 60000, { ip: '1.2.3.4' })
      expect(result.success).toBe(false)
    })
  })
})

// ─── Env validation tests ──────────────────────────────────────────────────────

describe('validateEnv production scenarios', () => {
  it('reports missing UPSTASH_REDIS_REST_URL in production', async () => {
    setEnv({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://db/test',
      DIRECT_URL: 'postgresql://db/test',
      NEXT_PUBLIC_SUPABASE_URL: 'https://test.supabase.co',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon',
      APP_DOMAIN: 'app.example.com',
      NEXT_PUBLIC_APP_DOMAIN: 'app.example.com',
      PAYMENT_PROVIDER: 'manual',
    })
    const { validateEnv } = await import('@/lib/env')
    const { errors } = validateEnv()
    const redisError = errors.find(e => e.key === 'UPSTASH_REDIS_REST_URL')
    expect(redisError).toBeDefined()
  })

  it('reports missing MERCADO_PAGO_ACCESS_TOKEN in production with mercado_pago', async () => {
    setEnv({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://db/test',
      DIRECT_URL: 'postgresql://db/test',
      NEXT_PUBLIC_SUPABASE_URL: 'https://test.supabase.co',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon',
      APP_DOMAIN: 'app.example.com',
      NEXT_PUBLIC_APP_DOMAIN: 'app.example.com',
      PAYMENT_PROVIDER: 'mercado_pago',
    })
    const { validateEnv } = await import('@/lib/env')
    const { errors } = validateEnv()
    const mpError = errors.find(e => e.key === 'MERCADO_PAGO_ACCESS_TOKEN')
    expect(mpError).toBeDefined()
  })

  it('reports missing MERCADO_PAGO_WEBHOOK_SECRET in production with mercado_pago', async () => {
    setEnv({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://db/test',
      DIRECT_URL: 'postgresql://db/test',
      NEXT_PUBLIC_SUPABASE_URL: 'https://test.supabase.co',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon',
      APP_DOMAIN: 'app.example.com',
      NEXT_PUBLIC_APP_DOMAIN: 'app.example.com',
      PAYMENT_PROVIDER: 'mercado_pago',
      MERCADO_PAGO_ACCESS_TOKEN: 'APP_USR-xxx',
    })
    const { validateEnv } = await import('@/lib/env')
    const { errors } = validateEnv()
    const secretError = errors.find(e => e.key === 'MERCADO_PAGO_WEBHOOK_SECRET')
    expect(secretError).toBeDefined()
  })
})

// ─── revalidateBusinessPublicPaths tests ──────────────────────────────────────

describe('revalidateBusinessPublicPaths', () => {
  it('function exists and is callable', async () => {
    // Verify the function exists and has correct signature
    const mod = await import('@/server/actions/revalidate-business')
    expect(typeof mod.revalidateBusinessPublicPaths).toBe('function')
  })

  it('tags used by revalidateBusinessPublicPaths match unstable_cache tags in public.ts', async () => {
    // Read the source files to verify tag alignment
    const fs = await import('fs')
    const path = await import('path')

    const publicTs = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/business/public.ts'),
      'utf-8'
    )
    const revalidateTs = fs.readFileSync(
      path.join(process.cwd(), 'src/server/actions/revalidate-business.ts'),
      'utf-8'
    )

    const cacheTags = [
      'public-business-by-slug',
      'public-business-by-subdomain',
      'booking-business-by-slug',
      'booking-business-by-subdomain',
    ]

    for (const tag of cacheTags) {
      // Each tag should appear in both files (cache definition and revalidate call)
      expect(publicTs).toContain(tag)
      expect(revalidateTs).toContain(tag)
    }
  })
})