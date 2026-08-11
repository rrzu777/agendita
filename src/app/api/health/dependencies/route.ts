import { NextResponse } from 'next/server'
import { hasValidBearerSecret } from '@/lib/auth/bearer-secret'
import {
  isDependencyReady,
  isMercadoPagoOAuthRequired,
  isMercadoPagoSubscriptionsRequired,
  probeMercadoPagoOAuth,
  probeMercadoPagoSubscriptions,
  probeRedis,
  probeResend,
  type ConfiguredDependencyStatus,
  type DependencyStatus,
} from '@/lib/health/dependencies'

export const dynamic = 'force-dynamic'

type DependencyHealthResponse = {
  status: 'ok' | 'degraded'
  checks: {
    redis: ConfiguredDependencyStatus
    resend: ConfiguredDependencyStatus
    mercadoPagoSubscriptions: DependencyStatus
    mercadoPagoOAuth: DependencyStatus
  }
  timestamp: string
}

export async function GET(request: Request) {
  if (!hasValidBearerSecret(request, process.env.CRON_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const [redis, resend, mercadoPagoSubscriptions, mercadoPagoOAuth] = await Promise.all([
    probeRedis(),
    probeResend(),
    probeMercadoPagoSubscriptions(),
    probeMercadoPagoOAuth(),
  ])
  const checks: DependencyHealthResponse['checks'] = {
    redis,
    resend,
    mercadoPagoSubscriptions,
    mercadoPagoOAuth,
  }
  const production = process.env.NODE_ENV === 'production'
  const healthy = isDependencyReady(checks.redis, production)
    && isDependencyReady(checks.resend, production)
    && isDependencyReady(
      checks.mercadoPagoSubscriptions,
      isMercadoPagoSubscriptionsRequired(),
    )
    && isDependencyReady(
      checks.mercadoPagoOAuth,
      isMercadoPagoOAuthRequired(),
    )
  const status: DependencyHealthResponse['status'] = healthy ? 'ok' : 'degraded'

  return NextResponse.json(
    { status, checks, timestamp: new Date().toISOString() },
    { status: healthy ? 200 : 503 },
  )
}
