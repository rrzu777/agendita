import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest'
import { NextRequest } from 'next/server'

const mockAuthError = class extends Error {
  constructor(message = 'No autorizado') {
    super(message)
    this.name = 'AuthError'
  }
}

const mockForbiddenError = class extends Error {
  constructor(message = 'No tienes permisos') {
    super(message)
    this.name = 'ForbiddenError'
  }
}

const mockRequireBusinessRole = vi.fn()
const mockCheckRateLimit = vi.fn()

vi.mock('@/lib/auth/server', () => ({
  requireBusinessRole: mockRequireBusinessRole,
  requireBusiness: vi.fn(),
  AuthError: mockAuthError,
  ForbiddenError: mockForbiddenError,
  assertResourceBelongsToBusiness: vi.fn(),
}))

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: mockCheckRateLimit,
}))

const mockLedgerFindMany = vi.fn()
const mockCustomerFindMany = vi.fn()
const mockPrisma = {
  ledgerEntry: {
    findMany: mockLedgerFindMany,
  },
  customer: {
    findMany: mockCustomerFindMany,
  },
}

vi.mock('@/lib/db', () => ({
  prisma: mockPrisma,
}))

function createRequest(from: string, to: string): NextRequest {
  const url = new URL(`http://localhost/api/dashboard/ledger/export?from=${from}&to=${to}`)
  return new NextRequest(url)
}

describe('GET /api/dashboard/ledger/export', () => {
  let GET: (request: NextRequest) => Promise<Response>

  beforeAll(async () => {
    const mod = await import('@/app/api/dashboard/ledger/export/route')
    GET = mod.GET
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckRateLimit.mockResolvedValue({ success: true, remaining: 9, resetAt: Date.now() + 60000 })
    mockCustomerFindMany.mockResolvedValue([])
  })

  it('rejects when requireBusinessRole throws ForbiddenError (staff)', async () => {
    mockRequireBusinessRole.mockRejectedValue(new mockForbiddenError('No tienes permisos'))

    const response = await GET(createRequest('2026-05-01', '2026-05-31'))

    expect(response.status).toBe(403)
    const body = await response.json()
    expect(body.error).toContain('permisos')
  })

  it('rejects when requireBusinessRole throws AuthError (no auth)', async () => {
    mockRequireBusinessRole.mockRejectedValue(new mockAuthError('No autorizado'))

    const response = await GET(createRequest('2026-05-01', '2026-05-31'))

    expect(response.status).toBe(401)
  })

  it('calls requireBusinessRole with owner and admin roles', async () => {
    mockRequireBusinessRole.mockResolvedValue({
      business: { id: 'biz-1', slug: 'mi-negocio', timezone: 'America/Santiago' },
      businessId: 'biz-1',
    })
    mockLedgerFindMany.mockResolvedValue([])

    await GET(createRequest('2026-05-01', '2026-05-31'))

    expect(mockRequireBusinessRole).toHaveBeenCalledWith(['owner', 'admin'])
  })

  it('returns 400 for invalid date format', async () => {
    const response = await GET(createRequest('01-05-2026', '2026-05-31'))
    expect(response.status).toBe(400)
  })

  it('returns 400 for invalid calendar date (Feb 31)', async () => {
    const response = await GET(createRequest('2026-02-31', '2026-03-01'))
    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.error).toContain('desde')
  })

  it('returns 400 for invalid calendar date (month 13)', async () => {
    const response = await GET(createRequest('2026-13-01', '2026-05-31'))
    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.error).toContain('desde')
  })

  it('returns 400 for invalid calendar date (Feb 29 non-leap)', async () => {
    const response = await GET(createRequest('2026-02-29', '2026-03-01'))
    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.error).toContain('desde')
  })

  it('accepts Feb 29 on leap year', async () => {
    mockRequireBusinessRole.mockResolvedValue({
      business: { id: 'biz-1', slug: 'mi-negocio', timezone: 'America/Santiago' },
      businessId: 'biz-1',
    })
    mockLedgerFindMany.mockResolvedValue([])

    const response = await GET(createRequest('2024-02-29', '2024-02-29'))
    expect(response.status).toBe(200)
  })

  it('returns 400 when from is after to', async () => {
    const response = await GET(createRequest('2026-05-31', '2026-05-01'))
    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.error).toContain('menor o igual')
  })

  it('returns 400 when range exceeds 366 days', async () => {
    const response = await GET(createRequest('2025-01-01', '2026-05-31'))
    expect(response.status).toBe(400)
  })

  it('enforces rate limit', async () => {
    mockCheckRateLimit.mockResolvedValue({ success: false, remaining: 0, resetAt: Date.now() + 60000 })

    const response = await GET(createRequest('2026-05-01', '2026-05-31'))

    expect(response.status).toBe(429)
    expect(mockCheckRateLimit).toHaveBeenCalledWith('export-ledger-csv', 10, 60000)
  })

  it('filters ledger entries by businessId', async () => {
    mockRequireBusinessRole.mockResolvedValue({
      business: { id: 'biz-1', slug: 'mi-negocio', timezone: 'America/Santiago' },
      businessId: 'biz-1',
    })
    mockLedgerFindMany.mockResolvedValue([])

    await GET(createRequest('2026-05-01', '2026-05-31'))

    const callArgs = mockLedgerFindMany.mock.calls[0][0]
    expect(callArgs.where.businessId).toBe('biz-1')
  })

  it('uses inclusive date range in business timezone', async () => {
    mockRequireBusinessRole.mockResolvedValue({
      business: { id: 'biz-1', slug: 'mi-negocio', timezone: 'America/Santiago' },
      businessId: 'biz-1',
    })
    mockLedgerFindMany.mockResolvedValue([])

    await GET(createRequest('2026-05-15', '2026-05-15'))

    const callArgs = mockLedgerFindMany.mock.calls[0][0]
    const gte = callArgs.where.occurredAt.gte
    const lte = callArgs.where.occurredAt.lte

    expect(gte).toBeInstanceOf(Date)
    expect(lte).toBeInstanceOf(Date)
    expect(gte.getTime()).toBeLessThanOrEqual(lte.getTime())
  })

  it('returns entries in ascending occurredAt order', async () => {
    mockRequireBusinessRole.mockResolvedValue({
      business: { id: 'biz-1', slug: 'mi-negocio', timezone: 'America/Santiago' },
      businessId: 'biz-1',
    })
    mockLedgerFindMany.mockResolvedValue([])

    await GET(createRequest('2026-05-01', '2026-05-31'))

    const callArgs = mockLedgerFindMany.mock.calls[0][0]
    expect(callArgs.orderBy).toEqual({ occurredAt: 'asc' })
  })

  it('includes booking with service and customer, and payment with customer', async () => {
    mockRequireBusinessRole.mockResolvedValue({
      business: { id: 'biz-1', slug: 'mi-negocio', timezone: 'America/Santiago' },
      businessId: 'biz-1',
    })
    mockLedgerFindMany.mockResolvedValue([])

    await GET(createRequest('2026-05-01', '2026-05-31'))

    const callArgs = mockLedgerFindMany.mock.calls[0][0]
    expect(callArgs.include).toEqual({
      booking: {
        include: {
          service: true,
          customer: true,
        },
      },
      payment: {
        include: {
          customer: true,
        },
      },
    })
  })

  it('batches unresolved customerId lookups', async () => {
    mockRequireBusinessRole.mockResolvedValue({
      business: { id: 'biz-1', slug: 'mi-negocio', timezone: 'America/Santiago' },
      businessId: 'biz-1',
    })
    mockLedgerFindMany.mockResolvedValue([
      {
        id: 'entry-1',
        businessId: 'biz-1',
        bookingId: null,
        paymentId: null,
        customerId: 'cust-99',
        type: 'manual_income',
        direction: 'income',
        amount: 5000,
        currency: 'CLP',
        description: null,
        occurredAt: new Date('2026-05-15T14:00:00Z'),
        booking: null,
        payment: null,
      },
    ])

    mockCustomerFindMany.mockResolvedValue([
      { id: 'cust-99', name: 'Cliente Suelto', phone: '+56911111111' },
    ])

    await GET(createRequest('2026-05-01', '2026-05-31'))

    expect(mockCustomerFindMany).toHaveBeenCalledWith({
      where: {
        id: { in: ['cust-99'] },
        businessId: 'biz-1',
      },
      select: { id: true, name: true, phone: true },
    })
  })

  it('does not query customers when all resolved from booking/payment', async () => {
    mockRequireBusinessRole.mockResolvedValue({
      business: { id: 'biz-1', slug: 'mi-negocio', timezone: 'America/Santiago' },
      businessId: 'biz-1',
    })
    mockLedgerFindMany.mockResolvedValue([
      {
        id: 'entry-1',
        businessId: 'biz-1',
        bookingId: 'booking-1',
        paymentId: null,
        customerId: 'cust-1',
        type: 'deposit_paid',
        direction: 'income',
        amount: 10000,
        currency: 'CLP',
        description: null,
        occurredAt: new Date('2026-05-15T14:00:00Z'),
        booking: {
          service: { name: 'Corte' },
          customer: { name: 'Juan', phone: '+56912345678' },
        },
        payment: null,
      },
    ])

    await GET(createRequest('2026-05-01', '2026-05-31'))

    expect(mockCustomerFindMany).not.toHaveBeenCalled()
  })

  it('returns correct Content-Type and Content-Disposition headers', async () => {
    mockRequireBusinessRole.mockResolvedValue({
      business: { id: 'biz-1', slug: 'mi-negocio', timezone: 'America/Santiago' },
      businessId: 'biz-1',
    })
    mockLedgerFindMany.mockResolvedValue([])

    const response = await GET(createRequest('2026-05-01', '2026-05-31'))

    expect(response.headers.get('Content-Type')).toBe('text/csv; charset=utf-8')
    const disposition = response.headers.get('Content-Disposition')
    expect(disposition).toContain('attachment')
    expect(disposition).toContain('agendita-finanzas-mi-negocio-2026-05-01_2026-05-31.csv')
  })

  it('sanitizes business slug in filename', async () => {
    mockRequireBusinessRole.mockResolvedValue({
      business: { id: 'biz-1', slug: 'mi negocio/2026', timezone: 'America/Santiago' },
      businessId: 'biz-1',
    })
    mockLedgerFindMany.mockResolvedValue([])

    const response = await GET(createRequest('2026-05-01', '2026-05-31'))

    const disposition = response.headers.get('Content-Disposition')
    expect(disposition).toContain('agendita-finanzas-mi_negocio_2026')
    expect(disposition).not.toContain('mi negocio/2026')
  })

  it('produces CSV with BOM in body', async () => {
    mockRequireBusinessRole.mockResolvedValue({
      business: { id: 'biz-1', slug: 'mi-negocio', timezone: 'America/Santiago' },
      businessId: 'biz-1',
    })
    mockLedgerFindMany.mockResolvedValue([])

    const response = await GET(createRequest('2026-05-01', '2026-05-31'))
    const buffer = await response.arrayBuffer()
    const bytes = new Uint8Array(buffer)

    expect(bytes[0]).toBe(0xef)
    expect(bytes[1]).toBe(0xbb)
    expect(bytes[2]).toBe(0xbf)
  })

  it('returns 500 on unexpected errors', async () => {
    mockRequireBusinessRole.mockResolvedValue({
      business: { id: 'biz-1', slug: 'mi-negocio', timezone: 'America/Santiago' },
      businessId: 'biz-1',
    })
    mockLedgerFindMany.mockRejectedValue(new Error('DB connection error'))

    const response = await GET(createRequest('2026-05-01', '2026-05-31'))

    expect(response.status).toBe(500)
  })
})
