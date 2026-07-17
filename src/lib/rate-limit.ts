/**
 * Serverless-safe rate limiter.
 * Interface + Memory implementation (dev/test) + Redis implementation (production).
 *
 * Hardening features:
 * - Explicit block list for known bad actors
 * - Per-action configurable limits and windows
 * - Fail-closed when Redis is unreachable (production)
 * - IP extraction from multiple headers with sanitization
 * - Action-specific keys prevent cross-action bypass
 * - Graceful fallback with logging
 */

import { headers as nextHeaders } from 'next/headers'

// ─── Types ────────────────────────────────────────────────────────────────────

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

// ─── Per-action limit configuration ───────────────────────────────────────────

/**
 * Configurable per-action rate limits.
 * Each action can have its own maxRequests and windowMs.
 */
export const RATE_LIMITS: Record<string, { maxRequests: number; windowMs: number }> = {
  'create-booking': { maxRequests: 20, windowMs: 60_000 },
  'update-booking-status': { maxRequests: 30, windowMs: 60_000 },
  'confirm-payment': { maxRequests: 30, windowMs: 60_000 },
  'create-manual-payment': { maxRequests: 20, windowMs: 60_000 },
  'get-availability': { maxRequests: 60, windowMs: 60_000 },
  'create-promotion': { maxRequests: 30, windowMs: 60_000 },
  'manage-promotion': { maxRequests: 60, windowMs: 60_000 },
  'preview-promotion': { maxRequests: 30, windowMs: 60_000 },
  'proof-upload-url': { maxRequests: 20, windowMs: 60_000 },
  'create-campaign': { maxRequests: 20, windowMs: 60_000 },
  'send-campaign': { maxRequests: 120, windowMs: 60_000 },
  'optout-public': { maxRequests: 10, windowMs: 60_000 },
  'default': { maxRequests: 60, windowMs: 60_000 },
}

/**
 * Block list: IP ranges or specific IPs that should always be rejected.
 * Add CIDR ranges or exact IPs of known bad actors.
 * Format: '192.168.1.1' or '10.0.0.0/8' (CIDR not currently supported,
 * use exact match for simplicity).
 */
const BLOCKED_IPS = new Set<string>([
  // Add known bad IPs here, e.g.:
  // '1.2.3.4',
])

// ─── IP extraction ─────────────────────────────────────────────────────────────

export async function getClientIp(request?: Request): Promise<string> {
  if (request) {
    const forwardedFor = request.headers.get('x-forwarded-for')
    if (forwardedFor) {
      // Take first IP (client), ignore proxy chain
      const ip = forwardedFor.split(',')[0].trim()
      if (isValidIp(ip)) return sanitizeIp(ip)
    }
    const realIp = request.headers.get('x-real-ip')
    if (realIp) {
      const ip = realIp.trim()
      if (isValidIp(ip)) return sanitizeIp(ip)
    }
  }

  // Fallback: try Next.js headers (server-side)
  try {
    const hdrs = await nextHeaders()
    const forwardedFor = hdrs.get('x-forwarded-for')
    if (forwardedFor) {
      const ip = forwardedFor.split(',')[0].trim()
      if (isValidIp(ip)) return sanitizeIp(ip)
    }
    const realIp = hdrs.get('x-real-ip')
    if (realIp) {
      const ip = realIp.trim()
      if (isValidIp(ip)) return sanitizeIp(ip)
    }
  } catch {
    // nextHeaders() can throw in non-server context
  }

  return 'unknown'
}

/**
 * Basic IP validation — rejects obviously invalid formats.
 * In production, rely on upstream proxy to set real IP.
 */
function isValidIp(ip: string): boolean {
  if (!ip || ip.length > 45) return false // max IPv6 length
  // IPv4 pattern
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(ip)) {
    const parts = ip.split('.').map(Number)
    return parts.every(p => p >= 0 && p <= 255)
  }
  // IPv6 pattern (simplified)
  if (ip.includes(':')) {
    return /^([0-9a-fA-F:]+)$/.test(ip)
  }
  return false
}

/**
 * Strip port from IP if present (some proxies send x-forwarded-for with port).
 */
function sanitizeIp(ip: string): string {
  return ip.replace(/:\d+$/, '').trim()
}

// ─── Key building ─────────────────────────────────────────────────────────────

function buildKey(action: string, ip: string, context?: RateLimitContext): string {
  const parts = [action, ip]
  if (context?.userId) parts.push(`u:${context.userId}`)
  if (context?.businessId) parts.push(`b:${context.businessId}`)
  return parts.join(':')
}

function isBlockedIp(ip: string): boolean {
  return BLOCKED_IPS.has(ip)
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
 * Fails closed if Redis is unreachable (returns blocked).
 * Logs all Redis errors for observability.
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
    // Upstash REST API: a single command is POSTed to the base URL as a flat
    // JSON array ["CMD", arg1, ...] and returns { result } (or { error }).
    // (The previous "/v1/commands" path doesn't exist → every call 404'd, which
    // tripped the fail-closed branch and blocked all rate-limited mutations.)
    const res = await fetch(this.restUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.restToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify([command, ...args]),
    })
    if (!res.ok) {
      throw new Error(`Upstash Redis error: ${res.status} ${res.statusText}`)
    }
    const json = await res.json()
    if (json.error) {
      throw new Error(`Upstash Redis error: ${json.error}`)
    }
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
      // Redis unreachable → fail closed (block the request)
      // This is intentional: a service degradation is better than no rate limiting
      console.error('[RateLimiter] Redis error — failing closed:', err)
      return { success: false, remaining: 0, resetAt: now + windowMs }
    }
  }
}

// ─── Fail-closed limiter (used when no valid Redis in production) ─────────────

class FailClosedRateLimiter implements RateLimiter {
  async check() {
    return { success: false, remaining: 0, resetAt: Date.now() + 60_000 }
  }
}

// ─── Singleton selector ────────────────────────────────────────────────────────

let _limiter: RateLimiter | null = null

function createRateLimiter(): RateLimiter {
  const nodeEnv = process.env.NODE_ENV || 'development'
  // The E2E harness runs with NODE_ENV=production but is not a real deployment
  // and has no Upstash. Use the in-memory limiter there (same carve-out the env
  // validation uses), so fail-closed doesn't block the test booking flow.
  const isRealProduction = nodeEnv === 'production' && process.env.APP_ENV !== 'e2e'

  if (isRealProduction) {
    const upstashUrl = process.env.UPSTASH_REDIS_REST_URL
    const upstashToken = process.env.UPSTASH_REDIS_REST_TOKEN
    if (upstashUrl && upstashToken) {
      return new RedisRateLimiter(upstashUrl, upstashToken)
    }
    // Production WITHOUT a distributed store: fail closed. An in-memory limiter
    // is per-isolate on serverless and provides no real protection, so we block
    // rather than silently allow unbounded requests. assertValidEnv() already
    // makes a missing Upstash config a hard error, so we should never reach here
    // in a correctly-configured deployment — this is the defensive fallback.
    console.error('[RateLimiter] Upstash not configured in production — failing closed. Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN.')
    return new FailClosedRateLimiter()
  }

  return new MemoryRateLimiter()
}

export function getLimiter(): RateLimiter {
  if (!_limiter) {
    _limiter = createRateLimiter()
  }
  return _limiter
}

// ─── Main API ─────────────────────────────────────────────────────────────────

/**
 * Server action API with IP-aware, action-specific keys.
 * Uses RATE_LIMITS config for per-action limits.
 * Logs rate_limit.blocked when a request is rejected.
 */
export async function checkRateLimit(
  action: string,
  maxRequests?: number,
  windowMs?: number,
  context?: RateLimitContext
): Promise<{ success: boolean; remaining: number; resetAt: number }> {
  // Apply per-action limits if not explicitly overridden
  const limitConfig = RATE_LIMITS[action] ?? RATE_LIMITS['default']
  const effectiveMax = maxRequests ?? limitConfig.maxRequests
  const effectiveWindow = windowMs ?? limitConfig.windowMs

  const limiter = getLimiter()
  const ip = context?.ip ?? await getClientIp()

  // Explicit block list check
  if (isBlockedIp(ip)) {
    const { logger } = await import('@/lib/logger')
    logger.rateLimit.blocked(action, ip, context?.businessId)
    return { success: false, remaining: 0, resetAt: Date.now() + effectiveWindow }
  }

  const result = await limiter.check(action, effectiveMax, effectiveWindow, { ...context, ip })
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

/**
 * Expose blocked IPs set for testing/debugging.
 * Do not mutate this set directly — use only for inspection.
 */
export function getBlockedIps(): Set<string> {
  return BLOCKED_IPS
}

/**
 * Add an IP to the block list at runtime (e.g., after detecting abuse).
 * For use in abuse response handlers — not for normal operation.
 */
export function blockIp(ip: string): void {
  BLOCKED_IPS.add(ip)
}

/**
 * Remove an IP from the block list.
 */
export function unblockIp(ip: string): void {
  BLOCKED_IPS.delete(ip)
}