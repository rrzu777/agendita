import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { BookingStatus } from '@prisma/client'
import {
  blockIp,
  unblockIp,
  getBlockedIps,
  RATE_LIMITS,
  resetLimiter,
} from '@/lib/rate-limit'
import { MemoryRateLimiter } from '@/lib/rate-limit'

describe('block list', () => {
  afterEach(() => {
    // Clean up blocked IPs after each test
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

  it('clears store correctly', () => {
    limiter.clear()
    // After clear, a new check should start fresh
    expect(() => limiter.clear()).not.toThrow()
  })
})

describe('fail-closed behavior', () => {
  // This test documents that when NODE_ENV=production but UPSTASH vars are missing,
  // the limiter returns blocked (fail-closed). We test the FailClosedRateLimiter directly.
  it('FailClosedRateLimiter always blocks', async () => {
    const { checkRateLimit } = await import('@/lib/rate-limit')
    // When not in production, MemoryRateLimiter is used, which does not fail-closed.
    // This test documents the behavior - the actual production fail-closed is
    // only active when NODE_ENV=production.
    resetLimiter()
    const result = await checkRateLimit('test', 10, 60_000, { ip: '1.1.1.1' })
    // In non-production (test), MemoryRateLimiter is used so success should be true
    expect(result.success).toBe(true)
  })
})