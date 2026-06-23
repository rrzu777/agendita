import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { BookingStatus, PaymentStatus, PaymentProvider } from '@prisma/client'

export const dynamic = 'force-dynamic'

// Metrics secret — if set, /api/metrics requires Bearer <METRICS_SECRET>
const METRICS_SECRET = process.env.METRICS_SECRET

// Prometheus-compatible text metrics endpoint.
// Requires Bearer Authorization with METRICS_SECRET when env var METRICS_SECRET is set.
// Grafana Cloud: add auth via "Add auth header" → "Authorization: Bearer <token>"
// or use a Grafana Cloud Data Source with "Basic auth" and a service account token.
//
// Example Grafana Cloud scraping config:
//  _url: https://your-app.vercel.app/api/metrics
//   auth: Bearer with token = value of METRICS_SECRET env var

// Simple in-memory cache (per-function-instance, resets on warm invocations)
// For production use, use Redis or Vercel KV.
let cachedMetrics: string | null = null
let cacheTimestamp = 0
const CACHE_TTL_MS = 30_000

async function gatherMetrics(): Promise<string> {
  const lines: string[] = []

  // agendita_bookings_total{businessId, status} COUNT
  try {
    const bookings = await prisma.$queryRaw<{ businessId: string; status: BookingStatus; count: bigint }[]>`
      SELECT "businessId", status, COUNT(*) as count
      FROM "Booking"
      GROUP BY "businessId", status
    `
    for (const row of bookings) {
      lines.push(`agendita_bookings_total{businessId="${row.businessId}",status="${row.status}"} ${row.count}`)
    }
  } catch {
    lines.push('# failed to gather booking metrics')
  }

  // agendita_payments_total{businessId, status} COUNT
  try {
    const payments = await prisma.$queryRaw<{ businessId: string; status: PaymentStatus; count: bigint }[]>`
      SELECT "businessId", status, COUNT(*) as count
      FROM "Payment"
      GROUP BY "businessId", status
    `
    for (const row of payments) {
      lines.push(`agendita_payments_total{businessId="${row.businessId}",status="${row.status}"} ${row.count}`)
    }
  } catch {
    lines.push('# failed to gather payment metrics')
  }

  // agendita_webhook_events_total{provider, event, status} COUNT
  try {
    const webhooks = await prisma.$queryRaw<{ provider: PaymentProvider; status: PaymentStatus; count: bigint }[]>`
      SELECT provider, status, COUNT(*) as count
      FROM "Payment"
      GROUP BY provider, status
    `
    for (const row of webhooks) {
      lines.push(`agendita_webhook_events_total{provider="${row.provider}",event="payment.update",status="${row.status}"} ${row.count}`)
    }
  } catch {
    lines.push('# failed to gather webhook metrics')
  }

  // agendita_rate_limit_blocked_total{action} — no persistent counter
  lines.push('agendita_rate_limit_blocked_total{action="api"} 0')

  // agendita_errors_total{type} — no persistent counter
  lines.push('agendita_errors_total{type="error500"} 0')

  lines.push(`# Generated at ${new Date().toISOString()}`)

  return lines.join('\n')
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  // Auth guard
  if (METRICS_SECRET) {
    const authHeader = request.headers.get('authorization')
    if (!authHeader || !authHeader.startsWith('Bearer ') || authHeader.slice(7) !== METRICS_SECRET) {
      return new NextResponse('Unauthorized', { status: 401 })
    }
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

  const body = await gatherMetrics()
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
