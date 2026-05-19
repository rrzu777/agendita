import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getTimeBlocksByRange } from '@/server/actions/time-blocks'

const mockRequireBusiness = vi.fn().mockResolvedValue({ businessId: 'biz-1' })
const mockFindMany = vi.fn().mockResolvedValue([])

vi.mock('@/lib/auth/server', () => ({
  requireBusiness: (...args: any[]) => mockRequireBusiness(...args),
}))

vi.mock('@/lib/db', () => ({
  prisma: {
    timeBlock: {
      findMany: (...args: any[]) => mockFindMany(...args),
    },
  },
}))

describe('getTimeBlocksByRange', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns time blocks filtered by business and date range overlap', async () => {
    mockFindMany.mockResolvedValueOnce([
      { id: 'tb1', startDateTime: new Date('2026-05-18T10:00:00Z') },
    ])
    const start = new Date('2026-05-01')
    const end = new Date('2026-05-31')

    const result = await getTimeBlocksByRange(start, end)

    expect(result.length).toBe(1)
    expect(result[0].id).toBe('tb1')
    expect(mockRequireBusiness).toHaveBeenCalledTimes(1)
    expect(mockFindMany).toHaveBeenCalledWith({
      where: {
        businessId: 'biz-1',
        OR: [
          { startDateTime: { gte: start, lte: end } },
          { endDateTime: { gte: start, lte: end } },
          { startDateTime: { lte: start }, endDateTime: { gte: end } },
        ],
      },
      orderBy: { startDateTime: 'asc' },
    })
  })

  it('returns empty array when no time blocks match', async () => {
    const result = await getTimeBlocksByRange(
      new Date('2026-05-01'),
      new Date('2026-05-31')
    )
    expect(result).toEqual([])
  })
})
