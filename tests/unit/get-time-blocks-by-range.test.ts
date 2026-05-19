import { describe, it, expect, vi } from 'vitest'
import { getTimeBlocksByRange } from '@/server/actions/time-blocks'

vi.mock('@/lib/auth/server', () => ({
  requireBusiness: vi.fn().mockResolvedValue({ businessId: 'biz-1' }),
}))

vi.mock('@/lib/db', () => ({
  prisma: {
    timeBlock: {
      findMany: vi.fn().mockResolvedValue([
        { id: 'tb1', startDateTime: new Date('2026-05-18T10:00:00Z') },
      ]),
    },
  },
}))

describe('getTimeBlocksByRange', () => {
  it('returns time blocks filtered by business and date range overlap', async () => {
    const result = await getTimeBlocksByRange(
      new Date('2026-05-01'),
      new Date('2026-05-31')
    )
    expect(result.length).toBe(1)
    expect(result[0].id).toBe('tb1')
  })
})
