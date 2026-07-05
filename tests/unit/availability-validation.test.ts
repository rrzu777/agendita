import { afterAll, beforeAll, describe, it, expect, vi } from 'vitest'
import { assertSlotIsAvailable } from '@/lib/availability/validation'

describe('assertSlotIsAvailable', () => {
  beforeAll(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-19T00:00:00Z'))
  })

  afterAll(() => {
    vi.useRealTimers()
  })

  const businessId = 'biz-1'
  const serviceId = 'svc-1'
  // Todas las fechas están en UTC explícito (Z)
  // El negocio opera en America/Santiago (UTC-4 en mayo).
  const timezone = 'America/Santiago'
  // 2026-05-20 14:00Z = 10:00 Santiago (Wednesday)
  const start = new Date('2026-05-20T14:00:00Z')
  const end = new Date('2026-05-20T15:00:00Z')

  function makeTx(mocks: Record<string, unknown> = {}) {
    return {
      ...mocks,
      business: { findUnique: vi.fn().mockResolvedValue({ bookingWindowDays: 90 }) },
      service: { findFirst: vi.fn().mockResolvedValue(mocks.service ?? null) },
      availabilityRule: { findFirst: vi.fn().mockResolvedValue(mocks.rule ?? null) },
      timeBlock: { findMany: vi.fn().mockResolvedValue(mocks.block ? [mocks.block] : []) },
      timeBlockSeries: { findMany: vi.fn().mockResolvedValue(mocks.series ?? []) },
      $executeRaw: vi.fn().mockResolvedValue(1),
      $queryRaw: vi.fn().mockResolvedValue(mocks.queryRawResult ?? []),
    } as unknown as Parameters<typeof assertSlotIsAvailable>[0]['tx']
  }

  it('rejects when end <= start', async () => {
    const tx = makeTx({ service: { durationMinutes: 60 } })
    await expect(assertSlotIsAvailable({ tx, businessId, serviceId, startDateTime: end, endDateTime: start, timezone }))
      .rejects.toThrow('Ese horario ya no está disponible')
  })

  it('rejects when start is in the past', async () => {
    const past = new Date(Date.now() - 1000 * 60 * 60)
    const pastEnd = new Date(past.getTime() + 1000 * 60 * 60)
    const tx = makeTx({ service: { durationMinutes: 60 } })
    await expect(assertSlotIsAvailable({ tx, businessId, serviceId, startDateTime: past, endDateTime: pastEnd, timezone }))
      .rejects.toThrow('Ese horario ya no está disponible')
  })

  it('rejects when service is missing or inactive', async () => {
    const tx = makeTx({ service: null })
    await expect(assertSlotIsAvailable({ tx, businessId, serviceId, startDateTime: start, endDateTime: end, timezone }))
      .rejects.toThrow('Ese horario ya no está disponible')
  })

  it('rejects when duration does not match service', async () => {
    const tx = makeTx({ service: { durationMinutes: 30 } })
    await expect(assertSlotIsAvailable({ tx, businessId, serviceId, startDateTime: start, endDateTime: end, timezone }))
      .rejects.toThrow('Ese horario ya no está disponible')
  })

  it('rejects when no active availability rule for day', async () => {
    const tx = makeTx({ service: { durationMinutes: 60 }, rule: null })
    await expect(assertSlotIsAvailable({ tx, businessId, serviceId, startDateTime: start, endDateTime: end, timezone }))
      .rejects.toThrow('Ese horario ya no está disponible')
  })

  it('rejects when slot is outside rule hours', async () => {
    // 18:00-19:00 Santiago = 22:00-23:00 UTC
    const rule = { dayOfWeek: 3, startTime: '09:00', endTime: '18:00', isActive: true }
    const lateStart = new Date('2026-05-20T22:00:00Z')
    const lateEnd = new Date('2026-05-20T23:00:00Z')
    const tx = makeTx({ service: { durationMinutes: 60 }, rule })
    await expect(assertSlotIsAvailable({ tx, businessId, serviceId, startDateTime: lateStart, endDateTime: lateEnd, timezone }))
      .rejects.toThrow('Ese horario ya no está disponible')
  })

  it('rejects when overlapping time block exists', async () => {
    const rule = { dayOfWeek: 3, startTime: '09:00', endTime: '18:00', isActive: true }
    // 10:00-11:00 Santiago = solapa exactamente el slot bajo prueba
    const block = { id: 'tb-1', startDateTime: new Date('2026-05-20T14:00:00Z'), endDateTime: new Date('2026-05-20T15:00:00Z'), overlapToleranceMinutes: 0 }
    const tx = makeTx({ service: { durationMinutes: 60 }, rule, block })
    await expect(assertSlotIsAvailable({ tx, businessId, serviceId, startDateTime: start, endDateTime: end, timezone }))
      .rejects.toThrow('Ese horario ya no está disponible')
  })

  it('rejects when overlapping booking exists (confirmed)', async () => {
    const rule = { dayOfWeek: 3, startTime: '09:00', endTime: '18:00', isActive: true }
    const tx = makeTx({ service: { durationMinutes: 60 }, rule, block: null, queryRawResult: [{ id: 'b1' }] })
    await expect(assertSlotIsAvailable({ tx, businessId, serviceId, startDateTime: start, endDateTime: end, timezone }))
      .rejects.toThrow('Ese horario ya no está disponible')
  })

  it('rejects when overlapping booking exists (pending_payment)', async () => {
    const rule = { dayOfWeek: 3, startTime: '09:00', endTime: '18:00', isActive: true }
    const tx = makeTx({ service: { durationMinutes: 60 }, rule, block: null, queryRawResult: [{ id: 'b1' }] })
    await expect(assertSlotIsAvailable({ tx, businessId, serviceId, startDateTime: start, endDateTime: end, timezone }))
      .rejects.toThrow('Ese horario ya no está disponible')
  })

  it('rejects when overlapping booking exists (completed)', async () => {
    const rule = { dayOfWeek: 3, startTime: '09:00', endTime: '18:00', isActive: true }
    const tx = makeTx({ service: { durationMinutes: 60 }, rule, block: null, queryRawResult: [{ id: 'b1' }] })
    await expect(assertSlotIsAvailable({ tx, businessId, serviceId, startDateTime: start, endDateTime: end, timezone }))
      .rejects.toThrow('Ese horario ya no está disponible')
  })

  it('allows contiguous booking (end === other.start)', async () => {
    const rule = { dayOfWeek: 3, startTime: '09:00', endTime: '18:00', isActive: true }
    const tx = makeTx({ service: { durationMinutes: 60 }, rule, block: null, queryRawResult: [] })
    await expect(assertSlotIsAvailable({ tx, businessId, serviceId, startDateTime: start, endDateTime: end, timezone }))
      .resolves.toBeUndefined()
  })

  it('allows cancelled bookings to be rebooked', async () => {
    const rule = { dayOfWeek: 3, startTime: '09:00', endTime: '18:00', isActive: true }
    const tx = makeTx({ service: { durationMinutes: 60 }, rule, block: null, queryRawResult: [] })
    await expect(assertSlotIsAvailable({ tx, businessId, serviceId, startDateTime: start, endDateTime: end, timezone }))
      .resolves.toBeUndefined()
  })

  it('allows no_show bookings to be rebooked', async () => {
    const rule = { dayOfWeek: 3, startTime: '09:00', endTime: '18:00', isActive: true }
    const tx = makeTx({ service: { durationMinutes: 60 }, rule, block: null, queryRawResult: [] })
    await expect(assertSlotIsAvailable({ tx, businessId, serviceId, startDateTime: start, endDateTime: end, timezone }))
      .resolves.toBeUndefined()
  })

  it('allows when all checks pass', async () => {
    const rule = { dayOfWeek: 3, startTime: '09:00', endTime: '18:00', isActive: true }
    const tx = makeTx({ service: { durationMinutes: 60 }, rule, block: null, queryRawResult: [] })
    await expect(assertSlotIsAvailable({ tx, businessId, serviceId, startDateTime: start, endDateTime: end, timezone }))
      .resolves.toBeUndefined()
  })

  it('uses business timezone for dayOfWeek calculation', async () => {
    // 2026-05-25 01:00 UTC = 2026-05-24 21:00 Santiago (Sunday)
    const utcMonday = new Date('2026-05-25T01:00:00Z')
    const utcEnd = new Date('2026-05-25T02:00:00Z') // 22:00 Santiago

    const rule = { dayOfWeek: 0, startTime: '21:00', endTime: '23:00', isActive: true }
    const findFirstSpy = vi.fn().mockResolvedValue(rule)
    const tx = {
      ...makeTx(),
      availabilityRule: { findFirst: findFirstSpy },
      service: { findFirst: vi.fn().mockResolvedValue({ durationMinutes: 60 }) },
    } as unknown as Parameters<typeof assertSlotIsAvailable>[0]['tx']

    await assertSlotIsAvailable({ tx, businessId, serviceId, startDateTime: utcMonday, endDateTime: utcEnd, timezone: 'America/Santiago' })

    expect(findFirstSpy).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ dayOfWeek: 0 })
    }))
  })

  it('uses same advisory lock for different times on the same day', async () => {
    // 10:00 y 14:00 Santiago (mismo día)
    const start1 = new Date('2026-05-20T14:00:00Z')
    const end1 = new Date('2026-05-20T15:00:00Z')
    const start2 = new Date('2026-05-20T18:00:00Z')
    const end2 = new Date('2026-05-20T19:00:00Z')

    const rule = { dayOfWeek: 3, startTime: '09:00', endTime: '18:00', isActive: true }
    const executeRawSpy = vi.fn().mockResolvedValue(1)
    const queryRawSpy = vi.fn().mockResolvedValue([])

    const makeTxWithSpy = () => ({
      ...makeTx(),
      service: { findFirst: vi.fn().mockResolvedValue({ durationMinutes: 60 }) },
      availabilityRule: { findFirst: vi.fn().mockResolvedValue(rule) },
      timeBlock: { findMany: vi.fn().mockResolvedValue([]) },
      $executeRaw: executeRawSpy,
      $queryRaw: queryRawSpy,
    })

    await assertSlotIsAvailable({ tx: makeTxWithSpy() as unknown as Parameters<typeof assertSlotIsAvailable>[0]['tx'], businessId, serviceId, startDateTime: start1, endDateTime: end1, timezone })
    await assertSlotIsAvailable({ tx: makeTxWithSpy() as unknown as Parameters<typeof assertSlotIsAvailable>[0]['tx'], businessId, serviceId, startDateTime: start2, endDateTime: end2, timezone })

    // Los locks deben ser iguales (mismos args de template literal + hash)
    const lockCall1 = executeRawSpy.mock.calls[0]
    const lockCall2 = executeRawSpy.mock.calls[1]
    expect(executeRawSpy).toHaveBeenCalledTimes(2)
    expect(lockCall1).toEqual(lockCall2)
    expect(queryRawSpy).toHaveBeenCalledTimes(2)
  })

  it('accepts a near-term slot when leadTimeMinutes is 0 (walk-in de la dueña)', async () => {
    // 30 min desde ahora: 2026-05-19T00:30Z = lunes 18 20:30 Santiago
    const soonStart = new Date('2026-05-19T00:30:00Z')
    const soonEnd = new Date('2026-05-19T01:30:00Z')
    const rule = { dayOfWeek: 1, startTime: '09:00', endTime: '22:00', isActive: true }
    const tx = makeTx({ service: { durationMinutes: 60 }, rule })
    await expect(assertSlotIsAvailable({ tx, businessId, serviceId, startDateTime: soonStart, endDateTime: soonEnd, timezone, leadTimeMinutes: 0 }))
      .resolves.toBeUndefined()
  })

  it('still rejects a near-term slot with the default lead time', async () => {
    const soonStart = new Date('2026-05-19T00:30:00Z')
    const soonEnd = new Date('2026-05-19T01:30:00Z')
    const rule = { dayOfWeek: 1, startTime: '09:00', endTime: '22:00', isActive: true }
    const tx = makeTx({ service: { durationMinutes: 60 }, rule })
    await expect(assertSlotIsAvailable({ tx, businessId, serviceId, startDateTime: soonStart, endDateTime: soonEnd, timezone }))
      .rejects.toThrow('Ese horario ya no está disponible')
  })

  it('rejects a slot in the past even with leadTimeMinutes 0', async () => {
    const pastStart = new Date('2026-05-18T20:00:00Z') // 4h antes de "ahora"
    const pastEnd = new Date('2026-05-18T21:00:00Z')
    const rule = { dayOfWeek: 1, startTime: '09:00', endTime: '22:00', isActive: true }
    const tx = makeTx({ service: { durationMinutes: 60 }, rule })
    await expect(assertSlotIsAvailable({ tx, businessId, serviceId, startDateTime: pastStart, endDateTime: pastEnd, timezone, leadTimeMinutes: 0 }))
      .rejects.toThrow('Ese horario ya no está disponible')
  })

  it('accepts a slot that only eats into the tolerance of a one-off block', async () => {
    const rule = { dayOfWeek: 3, startTime: '09:00', endTime: '18:00', isActive: true }
    // Bloqueo 10:30-12:30 Santiago (14:30Z-16:30Z) con tolerancia 45:
    // núcleo efectivo 11:15-11:45 → el slot 10:00-11:00 no lo toca.
    const block = {
      startDateTime: new Date('2026-05-20T14:30:00Z'),
      endDateTime: new Date('2026-05-20T16:30:00Z'),
      overlapToleranceMinutes: 45,
    }
    const tx = makeTx({ service: { durationMinutes: 60 }, rule, block })
    await expect(assertSlotIsAvailable({ tx, businessId, serviceId, startDateTime: start, endDateTime: end, timezone }))
      .resolves.toBeUndefined()
  })

  it('still rejects the same slot when the block has no tolerance', async () => {
    const rule = { dayOfWeek: 3, startTime: '09:00', endTime: '18:00', isActive: true }
    const block = {
      startDateTime: new Date('2026-05-20T14:30:00Z'),
      endDateTime: new Date('2026-05-20T16:30:00Z'),
      overlapToleranceMinutes: 0,
    }
    const tx = makeTx({ service: { durationMinutes: 60 }, rule, block })
    await expect(assertSlotIsAvailable({ tx, businessId, serviceId, startDateTime: start, endDateTime: end, timezone }))
      .rejects.toThrow('Ese horario ya no está disponible')
  })

  it('applies series tolerance to expanded occurrences', async () => {
    const rule = { dayOfWeek: 3, startTime: '09:00', endTime: '18:00', isActive: true }
    // Serie los miércoles 10:30-12:30 con tolerancia 45 → núcleo 11:15-11:45
    const makeSeries = (tolerance: number) => [{
      id: 'series-1',
      daysOfWeek: [3],
      startTime: '10:30',
      endTime: '12:30',
      reason: null,
      anchorDate: new Date('2026-05-01T04:00:00Z'),
      until: null,
      overlapToleranceMinutes: tolerance,
      exceptions: [],
    }]
    const tolerant = makeTx({ service: { durationMinutes: 60 }, rule, series: makeSeries(45) })
    await expect(assertSlotIsAvailable({ tx: tolerant, businessId, serviceId, startDateTime: start, endDateTime: end, timezone }))
      .resolves.toBeUndefined()

    const strict = makeTx({ service: { durationMinutes: 60 }, rule, series: makeSeries(0) })
    await expect(assertSlotIsAvailable({ tx: strict, businessId, serviceId, startDateTime: start, endDateTime: end, timezone }))
      .rejects.toThrow('Ese horario ya no está disponible')
  })
})
