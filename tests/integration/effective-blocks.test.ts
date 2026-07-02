import { PrismaClient } from '@prisma/client'
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { requireTestDatabase } from './setup'
import { getEffectiveBlocks } from '@/lib/availability/effective-blocks'

requireTestDatabase()

describe('getEffectiveBlocks', () => {
  let prisma: PrismaClient
  const businessId = 'eb-biz-1'
  const TZ = 'America/Santiago'

  beforeAll(async () => {
    // Reloj fijo un viernes; el lunes 2026-06-01 queda en el futuro y dentro de
    // la ventana de reserva (necesario para los tests de slots/validación de
    // Tasks 5 y 6, que usan `new Date()` real vía lead-time/booking-window).
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-05-29T12:00:00Z'))
    prisma = new PrismaClient()
    await prisma.timeBlockException.deleteMany()
    await prisma.timeBlockSeries.deleteMany()
    await prisma.timeBlock.deleteMany()
    await prisma.businessUser.deleteMany()
    await prisma.business.deleteMany()
    await prisma.user.deleteMany()

    const user = await prisma.user.create({ data: { id: 'eb-u1', email: 'eb@t.test', name: 'EB' } })
    await prisma.business.create({
      data: { id: businessId, name: 'EB', slug: 'eb', subdomain: 'eb', ownerUserId: user.id, city: 'Santiago', country: 'CL', currency: 'CLP', timezone: TZ, bookingWindowDays: 90 },
    })
    await prisma.timeBlock.create({
      data: { businessId, startDateTime: new Date('2026-06-05T14:00:00Z'), endDateTime: new Date('2026-06-05T15:00:00Z'), reason: 'Suelto' },
    })
    await prisma.timeBlockSeries.create({
      data: { businessId, daysOfWeek: [1, 2, 3, 4], startTime: '13:00', endTime: '14:00', reason: 'Almuerzo', anchorDate: new Date('2026-06-01T04:00:00Z'), until: null },
    })
  })

  afterAll(async () => { await prisma.$disconnect(); vi.useRealTimers() })

  it('une bloqueos sueltos + ocurrencias expandidas de la serie', async () => {
    const start = new Date('2026-06-01T00:00:00-04:00')
    const end = new Date('2026-06-05T23:59:59-04:00')
    const blocks = await getEffectiveBlocks(businessId, start, end, TZ)
    const reasons = blocks.map((b) => b.reason).sort()
    expect(blocks).toHaveLength(5) // 4 almuerzos (Lun-Jue) + 1 suelto (viernes)
    expect(reasons.filter((r) => r === 'Almuerzo')).toHaveLength(4)
    expect(reasons.filter((r) => r === 'Suelto')).toHaveLength(1)
  })

  it('un almuerzo recurrente bloquea el slot correspondiente en getAvailableTimeSlots', async () => {
    const { getAvailableTimeSlots } = await import('@/server/actions/availability')
    await prisma.availabilityRule.deleteMany({ where: { businessId } })
    await prisma.availabilityRule.create({ data: { businessId, dayOfWeek: 1, startTime: '09:00', endTime: '18:00', isActive: true } })
    const svc = await prisma.service.create({ data: { businessId, name: 'Corte', durationMinutes: 60, price: 10000, depositAmount: 0, pastelColor: '#FFD700', isActive: true } })
    const slots = await getAvailableTimeSlots(businessId, svc.id, new Date('2026-06-01T15:00:00Z'))
    expect(slots.some((s) => s.start.toISOString() === '2026-06-01T17:00:00.000Z')).toBe(false)
  })

  it('assertSlotIsAvailable rechaza un slot dentro de una ocurrencia recurrente y lo libera al saltarla', async () => {
    const { assertSlotIsAvailable } = await import('@/lib/availability/validation')
    await prisma.availabilityRule.deleteMany({ where: { businessId } })
    await prisma.availabilityRule.create({ data: { businessId, dayOfWeek: 1, startTime: '09:00', endTime: '18:00', isActive: true } })
    const svc = await prisma.service.create({ data: { businessId, name: 'Corte V', durationMinutes: 60, price: 10000, depositAmount: 0, pastelColor: '#FFD700', isActive: true } })
    const series = await prisma.timeBlockSeries.findFirstOrThrow({ where: { businessId } })

    const start = new Date('2026-06-01T17:00:00Z') // 13:00 local, lunes (en daysOfWeek [1..4])
    const end = new Date('2026-06-01T18:00:00Z')
    const input = { businessId, serviceId: svc.id, startDateTime: start, endDateTime: end, timezone: TZ }

    await expect(
      prisma.$transaction((tx) => assertSlotIsAvailable({ tx, ...input })),
    ).rejects.toThrow()

    await prisma.timeBlockException.create({ data: { seriesId: series.id, occurrenceDate: new Date('2026-06-01T04:00:00Z'), isSkipped: true } })
    await expect(
      prisma.$transaction((tx) => assertSlotIsAvailable({ tx, ...input })),
    ).resolves.toBeUndefined()
  })

  it('C1: una serie acotada sigue bloqueando su ÚLTIMO día (rangeStart a media tarde)', async () => {
    // serie de 1 semana Lun-Vie 13:00-14:00, ancla lunes 2026-06-01, until = viernes 2026-06-05 (00:00 local)
    await prisma.timeBlockException.deleteMany()
    await prisma.timeBlockSeries.deleteMany()
    await prisma.timeBlock.deleteMany({ where: { businessId } })
    await prisma.timeBlockSeries.create({
      data: { businessId, daysOfWeek: [1, 2, 3, 4, 5], startTime: '13:00', endTime: '14:00', reason: 'Almuerzo', anchorDate: new Date('2026-06-01T04:00:00Z'), until: new Date('2026-06-05T04:00:00Z') },
    })
    // rango de un solo día = el último día (viernes), arrancando a las 13:00 local (17:00Z)
    const blocks = await getEffectiveBlocks(businessId, new Date('2026-06-05T17:00:00Z'), new Date('2026-06-05T18:00:00Z'), TZ)
    expect(blocks.some((b) => b.reason === 'Almuerzo')).toBe(true)
  })
})
