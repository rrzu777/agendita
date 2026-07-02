import { PrismaClient } from '@prisma/client'
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { requireTestDatabase } from './setup'

requireTestDatabase()

vi.mock('@/lib/auth/server', () => ({
  requireBusiness: async () => ({ businessId: 'tbs-biz-1' }),
  requireBusinessRole: async () => ({ businessId: 'tbs-biz-1' }),
  ForbiddenError: class extends Error {},
}))
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: async () => ({ success: true }) }))
vi.mock('@/server/actions/revalidate-business', () => ({ revalidateBusinessPublicPaths: async () => {} }))
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))

describe('createTimeBlockSeries', () => {
  let prisma: PrismaClient
  const businessId = 'tbs-biz-1'

  beforeAll(async () => {
    prisma = new PrismaClient()
    await prisma.timeBlockException.deleteMany()
    await prisma.timeBlockSeries.deleteMany()
    await prisma.timeBlock.deleteMany()
    await prisma.businessUser.deleteMany()
    await prisma.business.deleteMany()
    await prisma.user.deleteMany()
    const u = await prisma.user.create({ data: { id: 'tbs-u1', email: 'tbs@t.test', name: 'T' } })
    await prisma.business.create({ data: { id: businessId, name: 'T', slug: 'tbs', subdomain: 'tbs', ownerUserId: u.id, city: 'Santiago', country: 'CL', currency: 'CLP', timezone: 'America/Santiago', bookingWindowDays: 90 } })
  })
  afterAll(async () => { await prisma.$disconnect() })

  it('crea una serie con until calculado para "weeks" y devuelve overlaps vacíos', async () => {
    const { createTimeBlockSeries } = await import('@/server/actions/time-blocks')
    const res = await createTimeBlockSeries({
      daysOfWeek: [1, 2, 3, 4], startTime: '13:00', endTime: '14:00', reason: 'Almuerzo',
      anchorDate: new Date('2026-06-01T04:00:00Z'), endMode: 'weeks', weeks: 3,
    })
    expect('series' in res).toBe(true)
    if ('series' in res) {
      expect(res.series.until).not.toBeNull()
      expect(res.overlappingDates).toEqual([])
    }
    const count = await prisma.timeBlockSeries.count({ where: { businessId } })
    expect(count).toBe(1)
  })

  it('skipSeriesOccurrence crea una excepción isSkipped', async () => {
    const { createTimeBlockSeries, skipSeriesOccurrence } = await import('@/server/actions/time-blocks')
    const { series } = await createTimeBlockSeries({ daysOfWeek: [1], startTime: '13:00', endTime: '14:00', reason: 'A', anchorDate: new Date('2026-06-01T04:00:00Z'), endMode: 'forever' }) as { series: { id: string } }
    await skipSeriesOccurrence(series.id, new Date('2026-06-08T04:00:00Z'))
    const exc = await prisma.timeBlockException.findFirst({ where: { seriesId: series.id } })
    expect(exc?.isSkipped).toBe(true)
  })

  it('overrideSeriesOccurrence hace upsert de un override', async () => {
    const { createTimeBlockSeries, overrideSeriesOccurrence } = await import('@/server/actions/time-blocks')
    const { series } = await createTimeBlockSeries({ daysOfWeek: [1], startTime: '13:00', endTime: '14:00', reason: 'A', anchorDate: new Date('2026-06-01T04:00:00Z'), endMode: 'forever' }) as { series: { id: string } }
    const occDate = new Date('2026-06-15T04:00:00Z')
    await overrideSeriesOccurrence(series.id, occDate, { startDateTime: new Date('2026-06-15T18:00:00Z'), endDateTime: new Date('2026-06-15T19:00:00Z'), reason: 'Movido' })
    await overrideSeriesOccurrence(series.id, occDate, { startDateTime: new Date('2026-06-15T19:00:00Z'), endDateTime: new Date('2026-06-15T20:00:00Z'), reason: 'Movido otra vez' })
    const exc = await prisma.timeBlockException.findMany({ where: { seriesId: series.id, isSkipped: false } })
    expect(exc).toHaveLength(1)
    expect(exc[0].reason).toBe('Movido otra vez')
  })
})
