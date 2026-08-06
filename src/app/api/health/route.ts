import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

export const dynamic = 'force-dynamic'

type HealthCheck = {
  status: 'ok' | 'degraded'
  checks: {
    db: 'up' | 'down'
    redis: 'not_configured' | 'up' | 'down'
    supabase: 'not_configured' | 'up' | 'down'
  }
  timestamp: string
}

type RedisHealthFailure =
  | 'partial_configuration'
  | 'timeout_or_network'
  | 'http_status'
  | 'invalid_response'

function logRedisHealthFailure(reason: RedisHealthFailure, status?: number): void {
  console.error(
    '[Health] Redis check failed',
    status === undefined ? { reason } : { reason, status }
  )
}

export async function GET(): Promise<NextResponse<HealthCheck>> {
  const checks: HealthCheck['checks'] = {
    db: 'down',
    redis: 'not_configured',
    supabase: 'not_configured',
  }

  // Check DB
  try {
    await prisma.$queryRaw`SELECT 1`
    checks.db = 'up'
  } catch {
    checks.db = 'down'
  }

  // Check Redis (Upstash) if configured
  const redisUrl = process.env.UPSTASH_REDIS_REST_URL
  const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN
  if (redisUrl || redisToken) {
    if (!redisUrl || !redisToken) {
      checks.redis = 'down'
      logRedisHealthFailure('partial_configuration')
    } else {
      try {
        const response = await fetch(redisUrl.replace(/\/$/, ''), {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${redisToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(['EVAL', 'return 1', 0]),
          signal: AbortSignal.timeout(3000),
        })

        if (!response.ok) {
          checks.redis = 'down'
          logRedisHealthFailure('http_status', response.status)
        } else {
          const payload: unknown = await response.json()
          checks.redis =
            typeof payload === 'object' &&
            payload !== null &&
            'result' in payload &&
            payload.result === 1
              ? 'up'
              : 'down'

          if (checks.redis === 'down') {
            logRedisHealthFailure('invalid_response')
          }
        }
      } catch (error) {
        checks.redis = 'down'
        logRedisHealthFailure(
          error instanceof SyntaxError ? 'invalid_response' : 'timeout_or_network'
        )
      }
    }
  }

  // Check Supabase if configured
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (supabaseUrl && supabaseKey) {
    try {
      const response = await fetch(`${supabaseUrl}/rest/v1/?limit=1`, {
        headers: {
          Authorization: `Bearer ${supabaseKey}`,
          apikey: supabaseKey,
        },
        signal: AbortSignal.timeout(3000),
      })
      checks.supabase = response.ok ? 'up' : 'down'
    } catch {
      checks.supabase = 'down'
    }
  }

  const status: HealthCheck['status'] =
    checks.db === 'up' &&
    (checks.redis === 'up' || checks.redis === 'not_configured') &&
    (checks.supabase === 'up' || checks.supabase === 'not_configured')
      ? 'ok'
      : 'degraded'

  return NextResponse.json(
    { status, checks, timestamp: new Date().toISOString() },
    { status: status === 'ok' ? 200 : 503 }
  )
}
