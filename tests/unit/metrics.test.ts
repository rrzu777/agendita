import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

const mockPrisma = {
  $queryRaw: vi.fn(),
}

vi.mock('@/lib/db', () => ({ prisma: mockPrisma }))

const SECRET = 'secret123'

// El endpoint falla cerrado: sin METRICS_SECRET nadie autentica. Los tests de
// emisión setean el secret (beforeEach) y mandan el Bearer válido para pasar el
// guard y llegar a gatherMetrics.
const authed = () =>
  new Request('http://localhost:3000/api/metrics', {
    headers: { authorization: `Bearer ${SECRET}` },
  })

describe('GET /api/metrics', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    process.env.METRICS_SECRET = SECRET
  })

  afterEach(() => {
    delete process.env.METRICS_SECRET
  })

  it('emits agendita_bookings_total metric', async () => {
    mockPrisma.$queryRaw
      .mockResolvedValueOnce([
        { businessId: 'biz-1', status: 'confirmed', count: 5n },
        { businessId: 'biz-1', status: 'pending', count: 2n },
      ])
      .mockResolvedValue([]) // payments empty
      .mockResolvedValue([]) // webhooks empty

    const { GET } = await import('@/app/api/metrics/route')
    const res = await GET(authed())

    expect(res.status).toBe(200)
    const body = await res.text()
    expect(body).toContain('agendita_bookings_total{businessId="biz-1",status="confirmed"} 5')
    expect(body).toContain('agendita_bookings_total{businessId="biz-1",status="pending"} 2')
  })

  it('emits agendita_payments_total metric', async () => {
    mockPrisma.$queryRaw
      .mockResolvedValueOnce([]) // bookings empty
      .mockResolvedValueOnce([
        { businessId: 'biz-1', status: 'approved', count: 3n },
        { businessId: 'biz-2', status: 'pending', count: 1n },
      ])
      .mockResolvedValueOnce([]) // webhooks empty

    const { GET } = await import('@/app/api/metrics/route')
    const res = await GET(authed())

    expect(res.status).toBe(200)
    const body = await res.text()
    expect(body).toContain('agendita_payments_total{businessId="biz-1",status="approved"} 3')
    expect(body).toContain('agendita_payments_total{businessId="biz-2",status="pending"} 1')
  })

  it('returns 401 when Authorization header is missing', async () => {
    const { GET } = await import('@/app/api/metrics/route')
    const request = new Request('http://localhost:3000/api/metrics')
    const res = await GET(request)

    expect(res.status).toBe(401)
  })

  it('returns 401 when token is wrong', async () => {
    const { GET } = await import('@/app/api/metrics/route')
    const request = new Request('http://localhost:3000/api/metrics', {
      headers: { authorization: 'Bearer wrong-token' },
    })
    const res = await GET(request)

    expect(res.status).toBe(401)
  })

  it('allows access when METRICS_SECRET matches Bearer token', async () => {
    mockPrisma.$queryRaw.mockResolvedValue([])

    const { GET } = await import('@/app/api/metrics/route')
    const res = await GET(authed())

    expect(res.status).toBe(200)
  })

  it('fails closed with 401 when METRICS_SECRET is not set', async () => {
    delete process.env.METRICS_SECRET
    mockPrisma.$queryRaw.mockResolvedValue([])

    const { GET } = await import('@/app/api/metrics/route')
    const request = new Request('http://localhost:3000/api/metrics')
    const res = await GET(request)

    // Sin secret configurado el endpoint NO sirve métricas por-tenant a un
    // llamador anónimo (regresión del leak: antes devolvía 200 abierto).
    expect(res.status).toBe(401)
  })

  it('emits webhook events metric', async () => {
    mockPrisma.$queryRaw
      .mockResolvedValueOnce([]) // bookings empty
      .mockResolvedValueOnce([]) // payments empty
      .mockResolvedValueOnce([
        { provider: 'mercado_pago', status: 'approved', count: 10n },
        { provider: 'mercado_pago', status: 'pending', count: 2n },
      ])

    const { GET } = await import('@/app/api/metrics/route')
    const res = await GET(authed())

    const body = await res.text()
    expect(body).toContain('agendita_webhook_events_total{provider="mercado_pago",event="payment.update",status="approved"} 10')
    expect(body).toContain('agendita_webhook_events_total{provider="mercado_pago",event="payment.update",status="pending"} 2')
  })
})
