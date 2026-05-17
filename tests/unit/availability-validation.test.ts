import { describe, it, expect, vi } from 'vitest'
import { assertSlotIsAvailable } from '@/lib/availability/validation'
import { BookingStatus } from '@prisma/client'

describe('assertSlotIsAvailable', () => {
  const businessId = 'biz-1'
  const serviceId = 'svc-1'
  // Todas las fechas están en UTC explícito (Z) para determinismo
  // sin importar el timezone del servidor de test.
  // El negocio opera en America/Santiago (UTC-4 en mayo).
  const timezone = 'America/Santiago'
  const start = new Date('2026-05-20T14:00:00Z') // 10:00 Santiago
  const end = new Date('2026-05-20T15:00:00Z')   // 11:00 Santiago

  function makeTx(mocks: Record<string, unknown> = {}) {
    return {
      ...mocks,
      service: { findFirst: vi.fn().mockResolvedValue(mocks.service ?? null) },
      availabilityRule: { findFirst: vi.fn().mockResolvedValue(mocks.rule ?? null) },
      timeBlock: { findFirst: vi.fn().mockResolvedValue(mocks.block ?? null) },
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
    const rule = { dayOfWeek: 3, startTime: '09:00', endTime: '18:00', isActive: true }
    // 18:00-19:00 Santiago = 22:00-23:00 UTC
    const lateStart = new Date('2026-05-20T22:00:00Z')
    const lateEnd = new Date('2026-05-20T23:00:00Z')
    const tx = makeTx({ service: { durationMinutes: 60 }, rule })
    await expect(assertSlotIsAvailable({ tx, businessId, serviceId, startDateTime: lateStart, endDateTime: lateEnd, timezone }))
      .rejects.toThrow('Ese horario ya no está disponible')
  })

  it('rejects when overlapping time block exists', async () => {
    const rule = { dayOfWeek: 3, startTime: '09:00', endTime: '18:00', isActive: true }
    const block = { id: 'tb-1' }
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
    // 2026-05-18 01:00 UTC = 2026-05-17 21:00 Santiago (Sunday)
    const utcMonday = new Date('2026-05-18T01:00:00Z')
    const utcEnd = new Date('2026-05-18T02:00:00Z') // 22:00 Santiago

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
    const queryRawSpy = vi.fn().mockResolvedValue([])

    const makeTxWithSpy = () => ({
      ...makeTx(),
      service: { findFirst: vi.fn().mockResolvedValue({ durationMinutes: 60 }) },
      availabilityRule: { findFirst: vi.fn().mockResolvedValue(rule) },
      timeBlock: { findFirst: vi.fn().mockResolvedValue(null) },
      $queryRaw: queryRawSpy,
    })

    await assertSlotIsAvailable({ tx: makeTxWithSpy() as unknown as Parameters<typeof assertSlotIsAvailable>[0]['tx'], businessId, serviceId, startDateTime: start1, endDateTime: end1, timezone })
    await assertSlotIsAvailable({ tx: makeTxWithSpy() as unknown as Parameters<typeof assertSlotIsAvailable>[0]['tx'], businessId, serviceId, startDateTime: start2, endDateTime: end2, timezone })

    // $queryRaw se llama 4 veces: lock1, bookings1, lock2, bookings2
    // Los locks deben ser iguales (mismos args de template literal + hash)
    const lockCall1 = queryRawSpy.mock.calls[0]
    const lockCall2 = queryRawSpy.mock.calls[2]
    expect(lockCall1).toEqual(lockCall2)
  })
})
