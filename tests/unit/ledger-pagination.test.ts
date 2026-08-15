import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockRequireBusiness = vi.fn().mockResolvedValue({ businessId: 'biz-1' })
const mockFindMany = vi.fn()
const mockFindFirst = vi.fn()

vi.mock('@/lib/auth/server', () => ({
  requireBusiness: (...args: unknown[]) => mockRequireBusiness(...args),
  requireBusinessRole: vi.fn(),
  ForbiddenError: class ForbiddenError extends Error {},
}))

vi.mock('@/lib/db', () => ({
  prisma: {
    ledgerEntry: {
      findMany: (...args: unknown[]) => mockFindMany(...args),
      findFirst: (...args: unknown[]) => mockFindFirst(...args),
    },
  },
}))

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: vi.fn() }))

const { getLedgerEntriesPage } = await import('@/server/actions/ledger')

describe('getLedgerEntriesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRequireBusiness.mockResolvedValue({ businessId: 'biz-1' })
  })

  it('returns a bounded stable page of ledger rows', async () => {
    mockFindMany.mockResolvedValue([{ id: 'l3' }, { id: 'l2' }, { id: 'l1' }])

    const page = await getLedgerEntriesPage({ limit: 2 })

    expect(page.items.map((entry) => entry.id)).toEqual(['l3', 'l2'])
    expect(page.nextCursor).toBe('l2')
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { businessId: 'biz-1' },
        take: 3,
        orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      }),
    )
  })

  it('returns no rows for a cursor outside the current business', async () => {
    mockFindFirst.mockResolvedValue(null)

    await expect(getLedgerEntriesPage({ cursor: 'ledger-other' })).resolves.toEqual({ items: [], nextCursor: null })
    expect(mockFindMany).not.toHaveBeenCalled()
  })
})
