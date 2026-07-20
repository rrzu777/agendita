import { PrismaClient } from '@prisma/client'
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { requireTestDatabase } from './setup'

requireTestDatabase()

const mockBusiness = { id: 'tbs-biz-1', timezone: 'America/Santiago', bookingWindowDays: 90 }
vi.mock('@/lib/auth/server', () => ({
  requireBusiness: async () => ({ businessId: 'tbs-biz-1', business: mockBusiness }),
  requireBusinessRole: async () => ({ businessId: 'tbs-biz-1', business: mockBusiness }),
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
    expect(res.ok && 'series' in res.data).toBe(true)
    if (res.ok && 'series' in res.data) {
      expect(res.data.series.until).not.toBeNull()
      expect(res.data.overlappingDates).toEqual([])
    }
    const count = await prisma.timeBlockSeries.count({ where: { businessId } })
    expect(count).toBe(1)
  })

  it('skipSeriesOccurrence crea una excepción isSkipped', async () => {
    const { createTimeBlockSeries, skipSeriesOccurrence } = await import('@/server/actions/time-blocks')
    const created = await createTimeBlockSeries({ daysOfWeek: [1], startTime: '13:00', endTime: '14:00', reason: 'A', anchorDate: new Date('2026-06-01T04:00:00Z'), endMode: 'forever' })
    if (!created.ok || !('series' in created.data)) throw new Error(created.ok ? 'esperaba serie creada' : created.error)
    const series = created.data.series
    await skipSeriesOccurrence(series.id, new Date('2026-06-08T04:00:00Z'))
    const exc = await prisma.timeBlockException.findFirst({ where: { seriesId: series.id } })
    expect(exc?.isSkipped).toBe(true)
  })

  it('overrideSeriesOccurrence hace upsert de un override', async () => {
    const { createTimeBlockSeries, overrideSeriesOccurrence } = await import('@/server/actions/time-blocks')
    const created = await createTimeBlockSeries({ daysOfWeek: [1], startTime: '13:00', endTime: '14:00', reason: 'A', anchorDate: new Date('2026-06-01T04:00:00Z'), endMode: 'forever' })
    if (!created.ok || !('series' in created.data)) throw new Error(created.ok ? 'esperaba serie creada' : created.error)
    const series = created.data.series
    const occDate = new Date('2026-06-15T04:00:00Z')
    await overrideSeriesOccurrence(series.id, occDate, { startDateTime: new Date('2026-06-15T18:00:00Z'), endDateTime: new Date('2026-06-15T19:00:00Z'), reason: 'Movido' })
    await overrideSeriesOccurrence(series.id, occDate, { startDateTime: new Date('2026-06-15T19:00:00Z'), endDateTime: new Date('2026-06-15T20:00:00Z'), reason: 'Movido otra vez' })
    const exc = await prisma.timeBlockException.findMany({ where: { seriesId: series.id, isSkipped: false } })
    expect(exc).toHaveLength(1)
    expect(exc[0].reason).toBe('Movido otra vez')
  })

  it('updateTimeBlockSeries hace split conservando los días y cambiando la hora', async () => {
    const { createTimeBlockSeries, updateTimeBlockSeries } = await import('@/server/actions/time-blocks')
    const created = await createTimeBlockSeries({ daysOfWeek: [1, 2, 3, 4], startTime: '13:00', endTime: '14:00', reason: 'A', anchorDate: new Date('2020-01-06T04:00:00Z'), endMode: 'forever' })
    if (!created.ok || !('series' in created.data)) throw new Error(created.ok ? 'esperaba serie creada' : created.error)
    const series = created.data.series
    const res = await updateTimeBlockSeries(series.id, { startTime: '12:30', endTime: '13:30', reason: 'A2' })
    const old = await prisma.timeBlockSeries.findUniqueOrThrow({ where: { id: series.id } })
    expect(old.until).not.toBeNull() // vieja cerrada
    if (!res.ok || !('series' in res.data)) throw new Error(res.ok ? 'esperaba split, no requiresConfirmation' : res.error)
    expect(res.data.series.id).not.toBe(series.id) // serie nueva
    expect(res.data.series.daysOfWeek).toEqual([1, 2, 3, 4]) // días PRESERVADOS
    expect(res.data.series.startTime).toBe('12:30') // hora cambiada
  })

  it('updateTimeBlockSeries edita en el lugar una serie solo-futura (sin split, misma id)', async () => {
    const { createTimeBlockSeries, updateTimeBlockSeries } = await import('@/server/actions/time-blocks')
    // Ancla muy en el futuro: no hay ocurrencias pasadas que preservar.
    const created = await createTimeBlockSeries({ daysOfWeek: [1, 2, 3], startTime: '13:00', endTime: '14:00', reason: 'A', anchorDate: new Date('2099-01-05T04:00:00Z'), endMode: 'forever' })
    if (!created.ok || !('series' in created.data)) throw new Error(created.ok ? 'esperaba serie creada' : created.error)
    const series = created.data.series
    const before = await prisma.timeBlockSeries.count({ where: { businessId } })
    const res = await updateTimeBlockSeries(series.id, { startTime: '12:30', endTime: '13:30', reason: 'A2' })
    if (!res.ok || !('series' in res.data)) throw new Error(res.ok ? 'esperaba edición en el lugar, no requiresConfirmation' : res.error)
    expect(res.data.series.id).toBe(series.id) // MISMA serie, no una nueva
    expect(res.data.series.startTime).toBe('12:30')
    expect(await prisma.timeBlockSeries.count({ where: { businessId } })).toBe(before) // no proliferan filas
  })

  it('updateTimeBlockSeries NO crea una serie fantasma al editar una serie ya terminada', async () => {
    const { createTimeBlockSeries, updateTimeBlockSeries } = await import('@/server/actions/time-blocks')
    // Serie totalmente en el pasado (anchor 2020, 1 semana): until << hoy.
    const created = await createTimeBlockSeries({ daysOfWeek: [1], startTime: '13:00', endTime: '14:00', reason: 'A', anchorDate: new Date('2020-01-06T04:00:00Z'), endMode: 'weeks', weeks: 1 })
    if (!created.ok || !('series' in created.data)) throw new Error(created.ok ? 'esperaba serie creada' : created.error)
    const series = created.data.series
    const res = await updateTimeBlockSeries(series.id, { startTime: '12:30', endTime: '13:30', reason: 'A2' })
    if (!res.ok || !('series' in res.data)) throw new Error(res.ok ? 'esperaba edición en el lugar' : res.error)
    expect(res.data.series.id).toBe(series.id)
    // Ninguna serie del negocio debe quedar con until anterior al anchor (fantasma).
    const all = await prisma.timeBlockSeries.findMany({ where: { businessId } })
    for (const s of all) {
      if (s.until) expect(s.until.getTime()).toBeGreaterThanOrEqual(s.anchorDate.getTime())
    }
  })

  it('C1: assertSlotIsAvailable rechaza un slot en el ÚLTIMO día de una serie acotada', async () => {
    // Reloj fijo antes del slot para que pase lead-time/booking-window (que usan Date real).
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-05-28T12:00:00Z'))
    try {
      const { createTimeBlockSeries } = await import('@/server/actions/time-blocks')
      const { assertSlotIsAvailable } = await import('@/lib/availability/validation')
      await prisma.availabilityRule.deleteMany({ where: { businessId } })
      await prisma.availabilityRule.create({ data: { businessId, dayOfWeek: 5, startTime: '09:00', endTime: '18:00', isActive: true } })
      const svc = await prisma.service.create({ data: { businessId, name: 'C1 svc', durationMinutes: 60, price: 10000, depositAmount: 0, pastelColor: '#FFD700', isActive: true } })
      // serie hasta viernes 2026-06-05 (00:00 local); slot ese viernes 13:00-14:00 (17:00Z-18:00Z)
      await createTimeBlockSeries({ daysOfWeek: [5], startTime: '13:00', endTime: '14:00', reason: 'Almuerzo', anchorDate: new Date('2026-05-29T04:00:00Z'), endMode: 'weeks', weeks: 1 })
      await expect(
        prisma.$transaction((tx) => assertSlotIsAvailable({ tx, businessId, serviceId: svc.id, startDateTime: new Date('2026-06-05T17:00:00Z'), endDateTime: new Date('2026-06-05T18:00:00Z'), timezone: 'America/Santiago' })),
      ).rejects.toThrow()
    } finally {
      vi.useRealTimers()
    }
  })

  it('deleteTimeBlockSeries borra la serie y sus excepciones', async () => {
    const { createTimeBlockSeries, skipSeriesOccurrence, deleteTimeBlockSeries } = await import('@/server/actions/time-blocks')
    const created = await createTimeBlockSeries({ daysOfWeek: [1], startTime: '13:00', endTime: '14:00', reason: 'A', anchorDate: new Date('2026-06-01T04:00:00Z'), endMode: 'forever' })
    if (!created.ok || !('series' in created.data)) throw new Error(created.ok ? 'esperaba serie creada' : created.error)
    const series = created.data.series
    await skipSeriesOccurrence(series.id, new Date('2026-06-08T04:00:00Z'))
    await deleteTimeBlockSeries(series.id)
    expect(await prisma.timeBlockSeries.findUnique({ where: { id: series.id } })).toBeNull()
    expect(await prisma.timeBlockException.count({ where: { seriesId: series.id } })).toBe(0)
  })
})
