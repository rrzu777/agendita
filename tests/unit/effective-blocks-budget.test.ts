import { describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { getEffectiveBlocks } from '@/lib/availability/effective-blocks'
const expand = vi.hoisted(() => vi.fn(() => []))
vi.mock('@/lib/db', () => ({ prisma: {} }))
vi.mock('@/lib/calendar/expand-series', () => ({ expandSeries: expand }))

describe('bounded public calendar block reads', () => {
  it.each(['oneOff', 'series', 'exceptions', 'expanded'])('rejects %s overflow rather than showing incomplete capacity', async (overflow) => {
    expand.mockReset().mockReturnValue(overflow === 'expanded' ? [{}, {}, {}] as never[] : [])
    const findOne = vi.fn().mockResolvedValue(overflow === 'oneOff' ? [{}, {}, {}] : [])
    const findSeries = vi.fn().mockResolvedValue(overflow === 'series' ? [{}, {}, {}] : [{ exceptions: overflow === 'exceptions' ? [{}, {}, {}] : [] }])
    await expect(getEffectiveBlocks({ businessId: 'biz', rangeStart: new Date('2026-09-14T00:00:00Z'), rangeEnd: new Date('2026-09-15T00:00:00Z'), timezone: 'UTC', scope: { kind: 'everyone' }, client: { timeBlock: { findMany: findOne }, timeBlockSeries: { findMany: findSeries } } as unknown as PrismaClient,
      limits: { oneOff: 2, series: 2, exceptionsPerSeries: 2, expanded: 2 },
    })).rejects.toThrow('Consulta un período más corto')
    expect(findOne).toHaveBeenCalledWith(expect.objectContaining({ take: 3 }))
    expect(findSeries).toHaveBeenCalledWith(expect.objectContaining({ take: 3, include: { exceptions: expect.objectContaining({ take: 3 }) } }))
    if (overflow !== 'expanded') expect(expand).not.toHaveBeenCalled()
  })
})
