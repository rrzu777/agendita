import { hasValidBearerSecret } from '@/lib/auth/bearer-secret'
import { runWeeklyInsightsJob } from '@/server/analytics/weekly-insights/job'
import {
  ANALYTICS_WEEKLY_INSIGHTS_JOB,
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
  if ([...url.searchParams.keys()].some(key => key !== 'cursor') || url.searchParams.getAll('cursor').length > 1 || (url.searchParams.get('cursor')?.length ?? 0) > 1024) return Response.json({ error: 'invalid_request' }, { status: 400, headers })
  if ((await request.text()).trim()) return Response.json({ error: 'invalid_request' }, { status: 400, headers })
  const runId = request.headers.get('x-analytics-run-id')
  const leaseToken = request.headers.get('x-analytics-lease-token')
  const batchHeader = request.headers.get('x-analytics-batch-sequence')
  if ((runId || leaseToken || batchHeader) && (!isUuid(runId) || !isUuid(leaseToken) || !batchHeader || !/^\d+$/.test(batchHeader))) return Response.json({ error: 'invalid_run' }, { status: 400, headers })
  let run: Awaited<ReturnType<typeof startAnalyticsJobRun>> | null = null
  try {
    run = runId && leaseToken && batchHeader
      ? { jobKey: ANALYTICS_WEEKLY_INSIGHTS_JOB, runId, leaseToken, batchSequence: Number(batchHeader), resumeCursor: null }
      : await startAnalyticsJobRun(ANALYTICS_WEEKLY_INSIGHTS_JOB)
    const activeRun = run!
    if (activeRun.batchSequence > 100000) return Response.json({ error: 'invalid_run' }, { status: 400, headers })
    const cursor = url.searchParams.get('cursor') ?? activeRun.resumeCursor
    const result = await runWeeklyInsightsJob({ now: new Date(), cursor })
    await recordAnalyticsJobProgress({ jobKey: ANALYTICS_WEEKLY_INSIGHTS_JOB, runId: activeRun.runId, leaseToken: activeRun.leaseToken, batchSequence: activeRun.batchSequence, hasMore: result.nextCursor !== null, errors: 0, nextCursor: result.nextCursor })
    const heartbeatFinished = result.nextCursor === null
      ? await finishAnalyticsJobRun({ jobKey: ANALYTICS_WEEKLY_INSIGHTS_JOB, runId: activeRun.runId, leaseToken: activeRun.leaseToken, status: 'succeeded', result: { errors: 0, hasMore: false, nextCursor: null } })
      : false
    if (result.nextCursor === null && !heartbeatFinished) return Response.json({ error: 'stale_run' }, { status: 409, headers })
    return Response.json({ ...result, runId: activeRun.runId, leaseToken: activeRun.leaseToken, batchSequence: activeRun.batchSequence, nextBatchSequence: activeRun.batchSequence + 1, heartbeatFinished }, { status: 200, headers })
  } catch {
    if (run) await finishAnalyticsJobRun({ jobKey: ANALYTICS_WEEKLY_INSIGHTS_JOB, runId: run.runId, leaseToken: run.leaseToken, status: 'failed', result: { errors: 1 } }).catch(() => undefined)
    return Response.json({ error: 'insights_failed' }, { status: 500, headers })
  }
}
