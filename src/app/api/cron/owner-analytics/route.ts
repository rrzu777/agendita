import { hasValidBearerSecret } from '@/lib/auth/bearer-secret'
import { runOwnerAnalyticsMaintenance } from '@/server/analytics/maintenance'
import {
  ANALYTICS_MAINTENANCE_JOB,
  finishAnalyticsJobRun,
  isUuid,
  recordAnalyticsJobProgress,
  startAnalyticsJobRun,
} from '@/server/analytics/operations/heartbeat'

export const runtime = 'nodejs'
export const maxDuration = 60

export async function POST(request: Request) {
  const headers = { 'Cache-Control': 'no-store' }
  if (!hasValidBearerSecret(request, process.env.CRON_SECRET)) return Response.json({ error: 'Unauthorized' }, { status: 401, headers })
  const url = new URL(request.url)
  if ([...url.searchParams.keys()].some(key => key !== 'cursor') || url.searchParams.getAll('cursor').length > 1 || (url.searchParams.get('cursor')?.length ?? 0) > 1024) return Response.json({ errors: 1, error: 'invalid_request' }, { status: 400, headers })
  const requestBody = await request.text()
  if (requestBody.trim()) return Response.json({ errors: 1, error: 'invalid_request' }, { status: 400, headers })
  const runId = request.headers.get('x-analytics-run-id')
  const leaseToken = request.headers.get('x-analytics-lease-token')
  const batchHeader = request.headers.get('x-analytics-batch-sequence')
  if ((runId || leaseToken || batchHeader) && (!isUuid(runId) || !isUuid(leaseToken) || !batchHeader || !/^\d+$/.test(batchHeader))) return Response.json({ errors: 1, error: 'invalid_run' }, { status: 400, headers })
  let run: Awaited<ReturnType<typeof startAnalyticsJobRun>> | null = null
  try {
    run = runId && leaseToken && batchHeader
      ? { jobKey: ANALYTICS_MAINTENANCE_JOB, runId, leaseToken, batchSequence: Number(batchHeader) }
      : await startAnalyticsJobRun(ANALYTICS_MAINTENANCE_JOB)
    if (run.batchSequence > 100000) return Response.json({ errors: 1, error: 'invalid_run' }, { status: 400, headers })
    const result = await runOwnerAnalyticsMaintenance({ cursor: url.searchParams.get('cursor') })
    await recordAnalyticsJobProgress({
      jobKey: ANALYTICS_MAINTENANCE_JOB,
      runId: run.runId,
      leaseToken: run.leaseToken,
      batchSequence: run.batchSequence,
      hasMore: result.hasMore,
      errors: result.errors,
      nextCursor: result.nextCursor,
    })
    const terminal = !result.hasMore || result.errors > 0
    const finished = terminal
      ? await finishAnalyticsJobRun({
          jobKey: ANALYTICS_MAINTENANCE_JOB,
          runId: run.runId,
          leaseToken: run.leaseToken,
          status: result.errors === 0 && !result.backlog.dangerous ? 'succeeded' : 'partial',
          result: { ...result, durationMs: 0 },
        })
      : false
    const body = { ...result, runId: run.runId, leaseToken: run.leaseToken, batchSequence: run.batchSequence, nextBatchSequence: run.batchSequence + 1, heartbeatFinished: finished }
    return Response.json(body, { status: result.errors ? 500 : 200, headers })
  } catch {
    if (run) await finishAnalyticsJobRun({ jobKey: ANALYTICS_MAINTENANCE_JOB, runId: run.runId, leaseToken: run.leaseToken, status: 'failed', result: { errors: 1 } }).catch(() => undefined)
    return Response.json({ errors: 1, error: 'maintenance_failed' }, { status: 500, headers })
  }
}
