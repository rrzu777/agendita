import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

const mockSnapshot = vi.fn()

vi.mock('@/lib/metrics/operational', () => ({
  getOperationalMetricsSnapshot: (...args: unknown[]) => mockSnapshot(...args),
}))

const SECRET = 'secret123'
const authed = () => new NextRequest('http://localhost:3000/api/metrics', {
  headers: { authorization: `Bearer ${SECRET}` },
})

describe('GET /api/metrics', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    process.env.METRICS_SECRET = SECRET
    mockSnapshot.mockReturnValue({
      startedAt: 1000,
      samples: [{ operation: 'create_booking', outcome: 'success', count: 4, durationMs: 120 }],
    })
  })

  afterEach(() => {
    delete process.env.METRICS_SECRET
  })

  it('emits aggregate operational metrics without database scans or tenant labels', async () => {
    const { GET } = await import('@/app/api/metrics/route')
    const res = await GET(authed())
    const body = await res.text()

    expect(res.status).toBe(200)
    expect(body).toContain('agendita_operation_total{operation="create_booking",outcome="success"} 4')
    expect(body).toContain('agendita_operation_duration_ms_sum{operation="create_booking",outcome="success"} 120')
    expect(body).not.toContain('businessId=')
  })

  it('reports an empty-but-healthy process before it observes an operation', async () => {
    mockSnapshot.mockReturnValue({ startedAt: 1000, samples: [] })
    const { GET } = await import('@/app/api/metrics/route')
    const body = await (await GET(authed())).text()

    expect(body).toContain('agendita_metrics_samples_total 0')
    expect(body).toContain('agendita_metrics_process_healthy 1')
  })

  it('returns 401 when Authorization header is missing', async () => {
    const { GET } = await import('@/app/api/metrics/route')
    expect((await GET(new NextRequest('http://localhost:3000/api/metrics'))).status).toBe(401)
  })

  it('returns 401 when token is wrong or the secret is not configured', async () => {
    const { GET } = await import('@/app/api/metrics/route')
    expect((await GET(new NextRequest('http://localhost:3000/api/metrics', {
      headers: { authorization: 'Bearer wrong-token' },
    }))).status).toBe(401)
    delete process.env.METRICS_SECRET
    expect((await GET(authed())).status).toBe(401)
  })
})
