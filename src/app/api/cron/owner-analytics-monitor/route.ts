import { hasValidBearerSecret } from '@/lib/auth/bearer-secret'
import { prisma } from '@/lib/db'
import { getOwnerAnalyticsOperationsConfig } from '@/lib/analytics/operations/config'
import { evaluateOwnerAnalyticsOperations } from '@/server/analytics/operations/incidents'
import { drainAnalyticsEmailOutbox } from '@/server/analytics/operations/email-outbox'

export const runtime = 'nodejs'
export const maxDuration = 60

export async function POST(request: Request) {
  const headers = { 'Cache-Control': 'no-store' }
  if (!hasValidBearerSecret(request, process.env.CRON_SECRET)) return Response.json({ error: 'Unauthorized' }, { status: 401, headers })
  const url = new URL(request.url)
  if ([...url.searchParams.keys()].length > 0) return Response.json({ error: 'invalid_request' }, { status: 400, headers })
  const body = await request.text()
  if (body.trim()) return Response.json({ error: 'invalid_request' }, { status: 400, headers })
  try {
    const config = getOwnerAnalyticsOperationsConfig()
    const result = await evaluateOwnerAnalyticsOperations()
    const heartbeat = config.monitorEnabled
      ? await prisma.analyticsJobHeartbeat.findUnique({ where: { jobKey: 'owner_analytics_maintenance' }, select: { lastStatus: true, lastStartedAt: true, lastCompletedAt: true, lastSuccessAt: true, lastProgressAt: true, consecutiveFailures: true, consecutiveSuccesses: true, runErrors: true, nextBatchSequence: true } })
      : null
    const deliveries = config.monitorEnabled && config.alertsEnabled && result.state === 'healthy'
      ? await drainAnalyticsEmailOutbox({ maxDeliveries: 10 })
      : { sent: 0, failed: 0, pending: 0 }
    return Response.json({ state: result.state, heartbeat, incidents: result.incidents, backlog: result.backlog, deliveries }, { status: 200, headers })
  } catch {
    return Response.json({ error: 'monitor_failed' }, { status: 500, headers })
  }
}
