/**
 * Serverless-safe rate limiter.
 * Interface + Memory implementation (dev/test) + Redis implementation (production).
 * Key always includes action + normalized IP + optional userId/businessId.
 */

import { headers as nextHeaders } from 'next/headers'

export interface RateLimitContext {
  ip?: string
  userId?: string
  businessId?: string
}

export interface RateLimiter {
  check(
    action: string,
    maxRequests: number,
    windowMs: number,
    context?: RateLimitContext
  ): Promise<{ success: boolean; remaining: number; resetAt: number }>
}

export async function getClientIp(request?: Request): Promise<string> {
  if (request) {
    const forwardedFor = request.headers.get('x-forwarded-for')
    if (forwardedFor) {
      return forwardedFor.split(',')[0].trim()
    }
    const realIp = request.headers.get('x-real-ip')
    if (realIp) {
      return realIp.trim()
    }
  }

  try {
    const hdrs = await nextHeaders()
    const forwardedFor = hdrs.get('x-forwarded-for')
    if (forwardedFor) {
      return forwardedFor.split(',')[0].trim()
    }
    const realIp = hdrs.get('x-real-ip')
    if (realIp) {
      return realIp.trim()
    }
  } catch {
    // nextHeaders() can throw in non-server context
  }

  return 'unknown'
}

function buildKey(action: string, ip: string, context?: RateLimitContext): string {
  const parts = [action, ip]
  if (context?.userId) parts.push(`u:${context.userId}`)
  if (context?.businessId) parts.push(`b:${context.businessId}`)
  return parts.join(':')
}

// ─── Memory implementation ──────────────────────────────────────────────────────

interface MemoryEntry {
  count: number
  resetAt: number
}

export class MemoryRateLimiter implements RateLimiter {
  private store = new Map<string, MemoryEntry>()

  async check(
    action: string,
    maxRequests: number,
    windowMs: number,
    context?: RateLimitContext
  ): Promise<{ success: boolean; remaining: number; resetAt: number }> {
    const ip = context?.ip ?? 'unknown'
    const key = buildKey(action, ip, context)
    const now = Date.now()
    const entry = this.store.get(key)

    if (!entry || now > entry.resetAt) {
      const resetAt = now + windowMs
      this.store.set(key, { count: 1, resetAt })
      return { success: true, remaining: maxRequests - 1, resetAt }
    }

    if (entry.count >= maxRequests) {
      return { success: false, remaining: 0, resetAt: entry.resetAt }
    }

    entry.count += 1
    return { success: true, remaining: maxRequests - entry.count, resetAt: entry.resetAt }
  }

  clear() {
    this.store.clear()
  }
}

// ─── Redis (Upstash REST) implementation ─────────────────────────────────────

/**
 * Upstash Redis REST API rate limiter.
 * Uses the Upstash REST API (HTTP) — compatible with serverless.
 *
 * API endpoint: POST /v1/eval
 * Docs: https://upstash.com/docs/redis/overall/getstarted
 *
 * Falls back to fail-closed (returns blocked) if Redis is unreachable.
 */
export class RedisRateLimiter implements RateLimiter {
  private restUrl: string
  private restToken: string

  constructor(restUrl: string, restToken: string) {
    this.restUrl = restUrl.replace(/\/$/, '')
    this.restToken = restToken
  }

  private async redisCommand(
    command: string,
    args: (string | number)[]
  ): Promise<unknown> {
    const res = await fetch(`${this.restUrl}/v1/commands`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.restToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify([[command, ...args]]),
    })
    if (!res.ok) {
      throw new Error(`Upstash Redis error: ${res.status} ${res.statusText}`)
    }
    // Upstash wraps responses in {result: ...}
    const json = await res.json()
    return json.result
  }

  async check(
    action: string,
    maxRequests: number,
    windowMs: number,
    context?: RateLimitContext
  ): Promise<{ success: boolean; remaining: number; resetAt: number }> {
    const ip = context?.ip ?? 'unknown'
    const key = buildKey(action, ip, context)
    const now = Date.now()
    const windowSec = Math.ceil(windowMs / 1000)

    // Lua script: fixed-window counter with TTL
    // returns [allowed (0|1), remaining, ttlSeconds]
    const script = `
      local key = KEYS[1]
      local limit = tonumber(ARGV[1])
      local window = tonumber(ARGV[2])

      local current = redis.call("GET", key)
      if current == false then
        redis.call("SETEX", key, window, 1)
        return {1, limit - 1, window}
      end

      local count = tonumber(current)
      if count >= limit then
        local ttl = redis.call("TTL", key)
        return {0, 0, ttl > 0 and ttl or window}
      end

      local new_count = redis.call("INCR", key)
      if new_count == 1 then
        redis.call("EXPIRE", key, window)
      end

      local ttl = redis.call("TTL", key)
      return {1, math.max(0, limit - new_count), ttl > 0 and ttl or window}
    `

    try {
      const result = await this.redisCommand('EVAL', [
        script,
        1,
        key,
        maxRequests,
        windowSec,
      ]) as [number, number, number]

      const [allowed, remaining, ttlSec] = result
      const resetAt = now + Math.max(0, ttlSec) * 1000

      return {
        success: allowed === 1,
        remaining,
        resetAt,
      }
    } catch (err) {
      // Redis unreachable → fail closed
      console.error('[RateLimiter] Redis error:', err)
      return { success: false, remaining: 0, resetAt: now + windowMs }
    }
  }
}

// ─── Singleton selector ────────────────────────────────────────────────────────

let _limiter: RateLimiter | null = null

function createRateLimiter(): RateLimiter {
  const nodeEnv = process.env.NODE_ENV || 'development'

  if (nodeEnv === 'production') {
    const upstashUrl = process.env.UPSTASH_REDIS_REST_URL
    const upstashToken = process.env.UPSTASH_REDIS_REST_TOKEN
    if (!upstashUrl || !upstashToken) {
      // Fail closed: no valid rate limiter available in production
      return new (class FailClosedRateLimiter implements RateLimiter {
        async check() {
          return { success: false, remaining: 0, resetAt: Date.now() + 60000 }
        }
      })()
    }
    return new RedisRateLimiter(upstashUrl, upstashToken)
  }

  return new MemoryRateLimiter()
}

export function getLimiter(): RateLimiter {
  if (!_limiter) {
    _limiter = createRateLimiter()
  }
  return _limiter
}

/**
 * Simple server action API — mirrors the old checkRateLimit signature
 * but adds IP-aware, action-specific keys.
 * Logs rate_limit.blocked when a request is rejected.
 */
export async function checkRateLimit(
  action: string,
  maxRequests: number = 10,
  windowMs: number = 60000,
  context?: RateLimitContext
): Promise<{ success: boolean; remaining: number; resetAt: number }> {
  const limiter = getLimiter()
  const ip = context?.ip ?? await getClientIp()
  const result = await limiter.check(action, maxRequests, windowMs, { ...context, ip })
  if (!result.success) {
    const { logger } = await import('@/lib/logger')
    logger.rateLimit.blocked(action, ip, context?.businessId)
  }
  return result
}

/** Reset limiter singleton — for testing only */
export function resetLimiter() {
  _limiter = null
}
