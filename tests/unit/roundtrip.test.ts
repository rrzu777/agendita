import { afterAll, beforeAll, describe, it, expect, vi } from 'vitest'
import { generateSlots } from '@/lib/availability/slots'
import { assertSlotIsAvailable } from '@/lib/availability/validation'

describe('timezone roundtrip', () => {
  beforeAll(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-19T00:00:00Z'))
  })

  afterAll(() => {
    vi.useRealTimers()
  })

  const timezone = 'America/Santiago'

  it('generateSlots -> assertSlotIsAvailable for 09:00 slot', async () => {
    // 2026-05-20T04:00:00Z = 00:00 miércoles en Santiago
    const date = new Date('2026-05-20T04:00:00Z')

    const rules = [{ dayOfWeek: 3, startTime: '09:00', endTime: '18:00', isActive: true }]
    const slots = generateSlots(date, 60, rules, [], [], { timezone, now: new Date('2026-05-19T04:00:00Z') })

    expect(slots.length).toBeGreaterThan(0)
    const firstSlot = slots[0]

    // assertSlotIsAvailable debe aceptar el slot generado
    const tx = {
      business: { findUnique: vi.fn().mockResolvedValue({ bookingWindowDays: 90 }) },
      service: { findFirst: vi.fn().mockResolvedValue({ durationMinutes: 60 }) },
      availabilityRule: { findFirst: vi.fn().mockResolvedValue({ dayOfWeek: 3, startTime: '09:00', endTime: '18:00', isActive: true }) },
      timeBlock: { findFirst: vi.fn().mockResolvedValue(null) },
      timeBlockSeries: { findMany: vi.fn().mockResolvedValue([]) },
      $executeRaw: vi.fn().mockResolvedValue(1),
      $queryRaw: vi.fn().mockResolvedValue([]),
    } as unknown as Parameters<typeof assertSlotIsAvailable>[0]['tx']

    await assertSlotIsAvailable({
      tx,
      businessId: 'biz-1',
      serviceId: 'svc-1',
      startDateTime: firstSlot.start,
      endDateTime: firstSlot.end,
      timezone,
    })
  })
})
