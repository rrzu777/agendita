import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { BookingStatus, PaymentStatus, PaymentProvider } from '@prisma/client'

export const dynamic = 'force-dynamic'

// Simple in-memory cache (per-function-instance, resets on warm invocations)
// For production use, use Redis or Vercel KV.
let cachedMetrics: string | null = null
let cacheTimestamp = 0
const CACHE_TTL_MS = 30_000

async function gatherMetrics(): Promise<string> {
  const lines: string[] = []

  // agendita_bookings_total{businessId, status} COUNT
  try {
    const bookings = await prisma.$queryRaw<{ businessId: string; status: BookingStatus; count: BigInt }[]>`
      SELECT business_id as "businessId", status, COUNT(*) as count
      FROM "Booking"
      GROUP BY business_id, status
    `
    for (const row of bookings) {
      lines.push(`agendita_bookings_total{businessId="${row.businessId}",status="${row.status}"} ${row.count}`)
    }
  } catch {
    lines.push('# failed to gather booking metrics')
  }

  // agendita_payments_total{businessId, status} COUNT
  try {
    const payments = await prisma.$queryRaw<{ businessId: string; status: PaymentStatus; count: BigInt }[]>`
      SELECT business_id as "businessId", status, COUNT(*) as count
      FROM "Payment"
      GROUP BY business_id, status
    `
    for (const row of payments) {
      lines.push(`agendita_payments_total{businessId="${row.businessId}",status="${row.status}"} ${row.count}`)
    }
  } catch {
    lines.push('# failed to gather payment metrics')
  }

  // agendita_webhook_events_total{provider, event, status} COUNT
  // Aggregated from PaymentAccount records (provider) + webhook log events if present
  // We approximate from Payment.provider distribution as a proxy
  try {
    const webhooks = await prisma.$queryRaw<{ provider: PaymentProvider; status: PaymentStatus; count: BigInt }[]>`
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

  // agendita_rate_limit_blocked_total{action} COUNT — no persistent counter, emit 0 placeholder
  lines.push('# agendita_rate_limit_blocked_total is tracked via logger events, not persisted')
  lines.push('agendita_rate_limit_blocked_total{action="api"} 0')

  // agendita_errors_total{type} COUNT — no persistent counter, emit 0 placeholder
  lines.push('# agendita_errors_total requires a metrics store; use logger events aggregated externally')
  lines.push('agendita_errors_total{type="error500"} 0')

  lines.push(`# Generated at ${new Date().toISOString()}`)

  return lines.join('\n')
}

export async function GET(): Promise<NextResponse> {
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