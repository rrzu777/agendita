import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import {
  isDependencyReady,
  probeRedis,
  probeSupabase,
  type ConfiguredDependencyStatus,
} from '@/lib/health/dependencies'

export const dynamic = 'force-dynamic'

type HealthCheck = {
  status: 'ok' | 'degraded'
  checks: {
    db: 'up' | 'down'
    redis: ConfiguredDependencyStatus
    supabase: ConfiguredDependencyStatus
  }
  timestamp: string
}

async function probeDatabase(): Promise<'up' | 'down'> {
  try {
    await prisma.$queryRaw`SELECT 1`
    return 'up'
  } catch {
    return 'down'
  }
}

export async function GET(): Promise<NextResponse<HealthCheck>> {
  const [db, redis, supabase] = await Promise.all([
    probeDatabase(),
    probeRedis(),
    probeSupabase(),
  ])
  const checks: HealthCheck['checks'] = { db, redis, supabase }
  const required = process.env.NODE_ENV === 'production'
  const healthy = checks.db === 'up'
    && isDependencyReady(checks.redis, required)
    && isDependencyReady(checks.supabase, required)
  const status: HealthCheck['status'] = healthy ? 'ok' : 'degraded'

  return NextResponse.json(
    { status, checks, timestamp: new Date().toISOString() },
    { status: status === 'ok' ? 200 : 503 }
  )
}
