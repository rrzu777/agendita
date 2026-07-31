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

  /** Agenda abierta 09:00-18:00 los días pedidos, y un servicio de una hora para
   *  reservar. Deja los bloqueos como estén: hay casos que usan los del `beforeAll`. */
  async function reglasYServicio(diasAbiertos: number[], nombreServicio: string) {
    await prisma.availabilityRule.deleteMany({ where: { businessId } })
    for (const dayOfWeek of diasAbiertos) {
      await prisma.availabilityRule.create({ data: { businessId, dayOfWeek, startTime: '09:00', endTime: '18:00', isActive: true } })
    }
    return prisma.service.create({
      data: { businessId, name: nombreServicio, durationMinutes: 60, price: 10000, depositAmount: 0, pastelColor: '#FFD700', isActive: true },
    })
  }

  /** Lo anterior, más borrar todo bloqueo: para los casos que arman su propia
   *  serie. Un bloqueo del caso anterior los haría pasar por el motivo equivocado. */
  async function escenarioLimpio(diasAbiertos: number[], nombreServicio: string) {
    await prisma.timeBlockException.deleteMany()
    await prisma.timeBlockSeries.deleteMany()
    await prisma.timeBlock.deleteMany({ where: { businessId } })
    return reglasYServicio(diasAbiertos, nombreServicio)
  }

  it('une bloqueos sueltos + ocurrencias expandidas de la serie', async () => {
    const start = new Date('2026-06-01T00:00:00-04:00')
    const end = new Date('2026-06-05T23:59:59-04:00')
    const blocks = await getEffectiveBlocks({ businessId, rangeStart: start, rangeEnd: end, timezone: TZ, scope: { kind: 'business' } })
    const reasons = blocks.map((b) => b.reason).sort()
    expect(blocks).toHaveLength(5) // 4 almuerzos (Lun-Jue) + 1 suelto (viernes)
    expect(reasons.filter((r) => r === 'Almuerzo')).toHaveLength(4)
    expect(reasons.filter((r) => r === 'Suelto')).toHaveLength(1)
  })

  it('un almuerzo recurrente bloquea el slot correspondiente en getAvailableTimeSlots', async () => {
    const { getAvailableTimeSlots } = await import('@/server/actions/availability')
    const svc = await reglasYServicio([1], 'Corte')
    const result = await getAvailableTimeSlots(businessId, svc.id, new Date('2026-06-01T15:00:00Z'), null)
    if (!result.ok) throw new Error(`expected ok, got: ${result.error}`)
    expect(result.data.some((s) => s.start.toISOString() === '2026-06-01T17:00:00.000Z')).toBe(false)
  })

  it('assertSlotIsAvailable rechaza un slot dentro de una ocurrencia recurrente y lo libera al saltarla', async () => {
    const { assertSlotIsAvailable } = await import('@/lib/availability/validation')
    const svc = await reglasYServicio([1], 'Corte V')
    const series = await prisma.timeBlockSeries.findFirstOrThrow({ where: { businessId } })

    const start = new Date('2026-06-01T17:00:00Z') // 13:00 local, lunes (en daysOfWeek [1..4])
    const end = new Date('2026-06-01T18:00:00Z')
    const input = { businessId, serviceId: svc.id, startDateTime: start, endDateTime: end, timezone: TZ, professionalId: null }

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
    const blocks = await getEffectiveBlocks({ businessId, rangeStart: new Date('2026-06-05T17:00:00Z'), rangeEnd: new Date('2026-06-05T18:00:00Z'), timezone: TZ, scope: { kind: 'business' } })
    expect(blocks.some((b) => b.reason === 'Almuerzo')).toBe(true)
  })

  // La dueña abre el bloqueo de un día y le cambia la FECHA: la excepción se guarda
  // con el día original como clave y el horario nuevo adentro. Preguntar por el día
  // nuevo no la encontraba, así que el bloqueo existía en el calendario pero no para
  // la validación: se podía reservar justo encima. Va como integración porque lo que
  // se afirma es lo que ve la clienta al reservar, no lo que devuelve una función.
  it('una ocurrencia movida a otro día bloquea el día NUEVO y libera el viejo', async () => {
    const { assertSlotIsAvailable } = await import('@/lib/availability/validation')
    const svc = await escenarioLimpio([1, 2], 'Corte M')
    // Almuerzo sólo los lunes...
    const series = await prisma.timeBlockSeries.create({
      data: { businessId, daysOfWeek: [1], startTime: '13:00', endTime: '14:00', reason: 'Almuerzo', anchorDate: new Date('2026-06-01T04:00:00Z'), until: null },
    })
    // ...y el del lunes 1 lo movió al martes 2 a las 15:00 local.
    await prisma.timeBlockException.create({
      data: {
        seriesId: series.id, occurrenceDate: new Date('2026-06-01T04:00:00Z'), isSkipped: false,
        startDateTime: new Date('2026-06-02T19:00:00Z'), endDateTime: new Date('2026-06-02T20:00:00Z'),
      },
    })

    const slot = (start: string, end: string) => ({
      businessId, serviceId: svc.id, startDateTime: new Date(start), endDateTime: new Date(end),
      timezone: TZ, professionalId: null,
    })

    await expect(
      prisma.$transaction((tx) => assertSlotIsAvailable({ tx, ...slot('2026-06-02T19:00:00Z', '2026-06-02T20:00:00Z') })),
    ).rejects.toThrow()

    await expect(
      prisma.$transaction((tx) => assertSlotIsAvailable({ tx, ...slot('2026-06-01T17:00:00Z', '2026-06-01T18:00:00Z') })),
    ).resolves.toBeUndefined()
  })

  // La misma movida, pero cruzando el fin de la serie. La query que trae las
  // series filtra por [anchorDate, until] dando por sentado que ninguna
  // ocurrencia cae afuera; moviendo la última un día más allá del `until`, la
  // serie entera queda fuera de la query y la repesca de `expandSeries` no llega
  // a correr nunca. Nada impide hacer esa movida: el diálogo deja elegir
  // cualquier fecha y la action no la acota.
  it('una ocurrencia movida más allá del fin de la serie sigue bloqueando', async () => {
    await escenarioLimpio([1], 'Corte F')

    // Lunes 13:00-14:00, del 1 al 8 de junio: la última ocurrencia es el lunes 8.
    const series = await prisma.timeBlockSeries.create({
      data: {
        businessId, daysOfWeek: [1], startTime: '13:00', endTime: '14:00', reason: 'Almuerzo',
        anchorDate: new Date('2026-06-01T04:00:00Z'), until: new Date('2026-06-08T04:00:00Z'),
      },
    })
    // ...que la dueña corrió al lunes SIGUIENTE, ya fuera de la serie.
    await prisma.timeBlockException.create({
      data: {
        seriesId: series.id, occurrenceDate: new Date('2026-06-08T04:00:00Z'), isSkipped: false,
        startDateTime: new Date('2026-06-15T17:00:00Z'), endDateTime: new Date('2026-06-15T18:00:00Z'),
      },
    })

    const blocks = await getEffectiveBlocks({
      businessId,
      rangeStart: new Date('2026-06-15T00:00:00-04:00'),
      rangeEnd: new Date('2026-06-15T23:59:59-04:00'),
      timezone: TZ,
      scope: { kind: 'business' },
    })
    expect(blocks.map((b) => b.startDateTime.toISOString())).toEqual(['2026-06-15T17:00:00.000Z'])
  })
})
