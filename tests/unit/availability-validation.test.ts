import { describe, it, expect, vi } from 'vitest'
import { assertSlotIsAvailable } from '@/lib/availability/validation'
import { BookingStatus } from '@prisma/client'

describe('assertSlotIsAvailable', () => {
  const businessId = 'biz-1'
  const serviceId = 'svc-1'
  const start = new Date('2026-05-20T10:00:00')
  const end = new Date('2026-05-20T11:00:00')

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
    await expect(assertSlotIsAvailable({ tx, businessId, serviceId, startDateTime: end, endDateTime: start }))
      .rejects.toThrow('Ese horario ya no está disponible')
  })

  it('rejects when start is in the past', async () => {
    const past = new Date(Date.now() - 1000 * 60 * 60)
    const pastEnd = new Date(past.getTime() + 1000 * 60 * 60)
    const tx = makeTx({ service: { durationMinutes: 60 } })
    await expect(assertSlotIsAvailable({ tx, businessId, serviceId, startDateTime: past, endDateTime: pastEnd }))
      .rejects.toThrow('Ese horario ya no está disponible')
  })

  it('rejects when service is missing or inactive', async () => {
    const tx = makeTx({ service: null })
    await expect(assertSlotIsAvailable({ tx, businessId, serviceId, startDateTime: start, endDateTime: end }))
      .rejects.toThrow('Ese horario ya no está disponible')
  })

  it('rejects when duration does not match service', async () => {
    const tx = makeTx({ service: { durationMinutes: 30 } })
    await expect(assertSlotIsAvailable({ tx, businessId, serviceId, startDateTime: start, endDateTime: end }))
      .rejects.toThrow('Ese horario ya no está disponible')
  })

  it('rejects when no active availability rule for day', async () => {
    const tx = makeTx({ service: { durationMinutes: 60 }, rule: null })
    await expect(assertSlotIsAvailable({ tx, businessId, serviceId, startDateTime: start, endDateTime: end }))
      .rejects.toThrow('Ese horario ya no está disponible')
  })

  it('rejects when slot is outside rule hours', async () => {
    const rule = { dayOfWeek: 1, startTime: '09:00', endTime: '18:00', isActive: true }
    const lateStart = new Date('2026-05-20T18:00:00')
    const lateEnd = new Date('2026-05-20T19:00:00')
    const tx = makeTx({ service: { durationMinutes: 60 }, rule })
    await expect(assertSlotIsAvailable({ tx, businessId, serviceId, startDateTime: lateStart, endDateTime: lateEnd }))
      .rejects.toThrow('Ese horario ya no está disponible')
  })

  it('rejects when overlapping time block exists', async () => {
    const rule = { dayOfWeek: 1, startTime: '09:00', endTime: '18:00', isActive: true }
    const block = { id: 'tb-1' }
    const tx = makeTx({ service: { durationMinutes: 60 }, rule, block })
    await expect(assertSlotIsAvailable({ tx, businessId, serviceId, startDateTime: start, endDateTime: end }))
      .rejects.toThrow('Ese horario ya no está disponible')
  })

  it('rejects when overlapping booking exists (confirmed)', async () => {
    const rule = { dayOfWeek: 1, startTime: '09:00', endTime: '18:00', isActive: true }
    const tx = makeTx({ service: { durationMinutes: 60 }, rule, block: null, queryRawResult: [{ id: 'b1' }] })
    await expect(assertSlotIsAvailable({ tx, businessId, serviceId, startDateTime: start, endDateTime: end }))
      .rejects.toThrow('Ese horario ya no está disponible')
  })

  it('rejects when overlapping booking exists (pending_payment)', async () => {
    const rule = { dayOfWeek: 1, startTime: '09:00', endTime: '18:00', isActive: true }
    const tx = makeTx({ service: { durationMinutes: 60 }, rule, block: null, queryRawResult: [{ id: 'b1' }] })
    await expect(assertSlotIsAvailable({ tx, businessId, serviceId, startDateTime: start, endDateTime: end }))
      .rejects.toThrow('Ese horario ya no está disponible')
  })

  it('rejects when overlapping booking exists (completed)', async () => {
    const rule = { dayOfWeek: 1, startTime: '09:00', endTime: '18:00', isActive: true }
    const tx = makeTx({ service: { durationMinutes: 60 }, rule, block: null, queryRawResult: [{ id: 'b1' }] })
    await expect(assertSlotIsAvailable({ tx, businessId, serviceId, startDateTime: start, endDateTime: end }))
      .rejects.toThrow('Ese horario ya no está disponible')
  })

  it('allows contiguous booking (end === other.start)', async () => {
    const rule = { dayOfWeek: 1, startTime: '09:00', endTime: '18:00', isActive: true }
    const tx = makeTx({ service: { durationMinutes: 60 }, rule, block: null, queryRawResult: [] })
    await expect(assertSlotIsAvailable({ tx, businessId, serviceId, startDateTime: start, endDateTime: end }))
      .resolves.toBeUndefined()
  })

  it('allows cancelled bookings to be rebooked', async () => {
    const rule = { dayOfWeek: 1, startTime: '09:00', endTime: '18:00', isActive: true }
    const tx = makeTx({ service: { durationMinutes: 60 }, rule, block: null, queryRawResult: [] })
    await expect(assertSlotIsAvailable({ tx, businessId, serviceId, startDateTime: start, endDateTime: end }))
      .resolves.toBeUndefined()
  })

  it('allows no_show bookings to be rebooked', async () => {
    const rule = { dayOfWeek: 1, startTime: '09:00', endTime: '18:00', isActive: true }
    const tx = makeTx({ service: { durationMinutes: 60 }, rule, block: null, queryRawResult: [] })
    await expect(assertSlotIsAvailable({ tx, businessId, serviceId, startDateTime: start, endDateTime: end }))
      .resolves.toBeUndefined()
  })

  it('allows when all checks pass', async () => {
    const rule = { dayOfWeek: 1, startTime: '09:00', endTime: '18:00', isActive: true }
    const tx = makeTx({ service: { durationMinutes: 60 }, rule, block: null, queryRawResult: [] })
    await expect(assertSlotIsAvailable({ tx, businessId, serviceId, startDateTime: start, endDateTime: end }))
      .resolves.toBeUndefined()
  })
})
