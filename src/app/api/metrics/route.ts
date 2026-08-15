import { NextRequest, NextResponse } from 'next/server'
import { hasValidBearerSecret } from '@/lib/auth/bearer-secret'
import { getOperationalMetricsSnapshot } from '@/lib/metrics/operational'

export const dynamic = 'force-dynamic'

let cachedMetrics: string | null = null
let cacheTimestamp = 0
const CACHE_TTL_MS = 30_000

function gatherMetrics(): string {
  const snapshot = getOperationalMetricsSnapshot()
  const lines = [
    '# HELP agendita_metrics_process_healthy Process-local operational metrics are available.',
    '# TYPE agendita_metrics_process_healthy gauge',
    'agendita_metrics_process_healthy 1',
    '# HELP agendita_metrics_samples_total Number of observed server operations in this process.',
    '# TYPE agendita_metrics_samples_total counter',
    `agendita_metrics_samples_total ${snapshot.samples.reduce((sum, sample) => sum + sample.count, 0)}`,
  ]

  for (const sample of snapshot.samples) {
    const labels = `operation="${sample.operation}",outcome="${sample.outcome}"`
    lines.push(`agendita_operation_total{${labels}} ${sample.count}`)
    lines.push(`agendita_operation_duration_ms_sum{${labels}} ${sample.durationMs}`)
  }

  lines.push(`# Process started at ${new Date(snapshot.startedAt).toISOString()}`)
  return lines.join('\n')
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!hasValidBearerSecret(request, process.env.METRICS_SECRET)) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  const now = Date.now()
  if (cachedMetrics && now - cacheTimestamp < CACHE_TTL_MS) {
    return new NextResponse(cachedMetrics, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'private, max-age=30',
        'X-Metrics-Cached': 'true',
      },
    })
  }

  const body = gatherMetrics()
  cachedMetrics = body
  cacheTimestamp = now
  return new NextResponse(body, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'private, max-age=30',
      'X-Metrics-Cached': 'false',
    },
  })
}
