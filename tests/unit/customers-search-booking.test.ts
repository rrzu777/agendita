import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockFindMany = vi.fn()
const mockRequireBusiness = vi.fn()

vi.mock('@/lib/db', () => ({
  prisma: {
    customer: {
      findMany: (...args: unknown[]) => mockFindMany(...args),
    },
  },
}))

vi.mock('@/lib/auth/server', () => ({
  requireBusiness: (...args: unknown[]) => mockRequireBusiness(...args),
  requireBusinessRole: vi.fn(),
  ForbiddenError: class extends Error {},
}))

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ success: true }),
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

const { searchCustomersForBooking } = await import('@/server/actions/customers')

describe('searchCustomersForBooking', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRequireBusiness.mockResolvedValue({ businessId: 'biz-1' })
    mockFindMany.mockResolvedValue([
      { id: 'cust-1', name: 'Maria Perez', phone: '56912345678', email: 'maria@test.com' },
    ])
  })

  it('searches customers scoped to current business', async () => {
    const result = await searchCustomersForBooking('Maria')

    expect(result.ok).toBe(true)
    expect(result.ok && result.data).toHaveLength(1)
    expect(mockFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ businessId: 'biz-1' }),
      take: 10,
      select: { id: true, name: true, phone: true, email: true },
    }))
  })

  it('normalizes Chilean phone for search', async () => {
    await searchCustomersForBooking('+56 9 1234 5678')

    const where = mockFindMany.mock.calls[0][0].where
    expect(where.OR).toContainEqual({ phone: { contains: '56912345678' } })
  })

  it('does not query for empty query', async () => {
    const result = await searchCustomersForBooking('')

    expect(result).toEqual({ ok: true, data: [] })
    expect(mockFindMany).not.toHaveBeenCalled()
  })

  it('returns only minimal booking suggestion fields', async () => {
    await searchCustomersForBooking('Maria')

    const query = mockFindMany.mock.calls[0][0]
    expect(query.select).toEqual({
      id: true,
      name: true,
      phone: true,
      email: true,
    })
  })

  it('limits results to 10', async () => {
    await searchCustomersForBooking('Maria')

    expect(mockFindMany.mock.calls[0][0].take).toBe(10)
  })
})
