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
  if (redisUrl) {
    try {
      const response = await fetch(`${redisUrl}/`, {
        headers: { Authorization: `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN ?? ''}` },
        signal: AbortSignal.timeout(3000),
      })
      checks.redis = response.ok ? 'up' : 'down'
    } catch {
      checks.redis = 'down'
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

  const allUp = checks.db === 'up' && checks.redis === 'not_configured' && checks.supabase === 'not_configured'
  const status: HealthCheck['status'] =
    checks.db === 'up' && (checks.redis === 'up' || checks.redis === 'not_configured') && (checks.supabase === 'up' || checks.supabase === 'not_configured')
      ? 'ok'
      : checks.db === 'up'
        ? 'degraded'
        : 'degraded'

  return NextResponse.json(
    { status, checks, timestamp: new Date().toISOString() },
    { status: status === 'ok' ? 200 : 503 }
  )
}