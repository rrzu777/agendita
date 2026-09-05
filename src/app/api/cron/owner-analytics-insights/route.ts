import { hasValidBearerSecret } from '@/lib/auth/bearer-secret'
import { runWeeklyInsightsJob } from '@/server/analytics/weekly-insights/job'

export const runtime = 'nodejs'
export const maxDuration = 60

export async function POST(request: Request) {
  const headers = { 'Cache-Control': 'no-store' }
  if (!hasValidBearerSecret(request, process.env.CRON_SECRET)) return Response.json({ error: 'Unauthorized' }, { status: 401, headers })
  const url = new URL(request.url)
  if ([...url.searchParams.keys()].some(key => key !== 'cursor') || url.searchParams.getAll('cursor').length > 1 || (url.searchParams.get('cursor')?.length ?? 0) > 1024) return Response.json({ error: 'invalid_request' }, { status: 400, headers })
  if ((await request.text()).trim()) return Response.json({ error: 'invalid_request' }, { status: 400, headers })
  try {
    const result = await runWeeklyInsightsJob({ now: new Date(), cursor: url.searchParams.get('cursor') })
    return Response.json(result, { status: 200, headers })
  } catch {
    return Response.json({ error: 'insights_failed' }, { status: 500, headers })
  }
}
