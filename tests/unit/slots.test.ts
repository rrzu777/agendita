import { describe, it, expect } from 'vitest'
import { generateSlots } from '@/lib/availability/slots'

describe('generateSlots', () => {
  const timezone = 'America/Santiago'
  // 2026-05-11T04:00:00Z = 00:00 lunes en Santiago
  const baseDate = new Date('2026-05-11T04:00:00Z')
  // now anterior al día de test para no interferir con lead time
  const testNow = new Date('2026-05-10T04:00:00Z')

  const rules = [
    { dayOfWeek: 1, startTime: '09:00', endTime: '18:00', isActive: true },
  ]

  it('generates slots for a normal day', () => {
    const slots = generateSlots(baseDate, 60, rules, [], [], { timezone, now: testNow })
    expect(slots.length).toBeGreaterThan(0)
    // 09:00 Santiago = 13:00 UTC
    expect(slots[0].start.toISOString()).toBe('2026-05-11T13:00:00.000Z')
  })

  it('respects availability rules', () => {
    const slots = generateSlots(baseDate, 60, rules, [], [], { timezone, now: testNow })
    const lastSlot = slots[slots.length - 1]
    // 17:00-18:00 Santiago = 21:00-22:00 UTC
    expect(lastSlot.end.toISOString()).toBe('2026-05-11T22:00:00.000Z')
  })

  it('excludes blocked time', () => {
    const blocks = [
      {
        // 12:00-13:00 Santiago = 16:00-17:00 UTC
        startDateTime: new Date('2026-05-11T16:00:00Z'),
        endDateTime: new Date('2026-05-11T17:00:00Z'),
      },
    ]
    const slots = generateSlots(baseDate, 60, rules, blocks, [], { timezone, now: testNow })
    const hasSlotAt12 = slots.some((s) => s.start.toISOString() === '2026-05-11T16:00:00.000Z')
    expect(hasSlotAt12).toBe(false)
  })

  it('excludes existing bookings', () => {
    const bookings = [
      {
        // 10:00-11:00 Santiago = 14:00-15:00 UTC
        startDateTime: new Date('2026-05-11T14:00:00Z'),
        endDateTime: new Date('2026-05-11T15:00:00Z'),
        status: 'confirmed',
      },
    ]
    const slots = generateSlots(baseDate, 60, rules, [], bookings, { timezone, now: testNow })
    const hasSlotAt10 = slots.some((s) => s.start.toISOString() === '2026-05-11T14:00:00.000Z')
    expect(hasSlotAt10).toBe(false)
  })

  it('allows cancelled bookings to be rebooked', () => {
    const bookings = [
      {
        startDateTime: new Date('2026-05-11T14:00:00Z'),
        endDateTime: new Date('2026-05-11T15:00:00Z'),
        status: 'cancelled',
      },
    ]
    const slots = generateSlots(baseDate, 60, rules, [], bookings, { timezone, now: testNow })
    const hasSlotAt10 = slots.some((s) => s.start.toISOString() === '2026-05-11T14:00:00.000Z')
    expect(hasSlotAt10).toBe(true)
  })

  it('filters past slots when date is today', () => {
    // 2026-05-20T04:00:00Z = 00:00 miércoles en Santiago
    const today = new Date('2026-05-20T04:00:00Z')
    const now = new Date('2026-05-20T18:00:00Z') // 14:00 Santiago

    const localRules = [
      { dayOfWeek: 3, startTime: '09:00', endTime: '18:00', isActive: true },
    ]

    const slots = generateSlots(today, 60, localRules, [], [], { timezone, now })
    const hasMorningSlot = slots.some((s) => s.start.toISOString() < '2026-05-20T18:00:00.000Z')
    expect(hasMorningSlot).toBe(false)
    expect(slots.length).toBeGreaterThan(0)
  })

  it('respects timezone for dayOfWeek calculation', () => {
    // UTC Sunday 23:00 = Sunday 19:00 in America/Santiago
    const utcSundayLate = new Date('2026-05-10T23:00:00Z')
    const santiagoRules = [
      { dayOfWeek: 0, startTime: '09:00', endTime: '18:00', isActive: true },
    ]
    const slots = generateSlots(utcSundayLate, 60, santiagoRules, [], [], { timezone: 'America/Santiago', now: testNow })
    expect(slots.length).toBeGreaterThan(0)
    expect(slots[0].start.toISOString()).toBe('2026-05-10T13:00:00.000Z') // 09:00 Santiago
  })

  it('uses step increment equal to durationMinutes', () => {
    const slots = generateSlots(baseDate, 90, rules, [], [], { timezone, now: testNow })
    expect(slots.length).toBe(6) // 09:00 to 16:30 = 6 slots of 90min
    expect(slots[0].start.toISOString()).toBe('2026-05-11T13:00:00.000Z')
    expect(slots[1].start.toISOString()).toBe('2026-05-11T14:30:00.000Z')
  })

  it('filters slots within leadTimeMinutes of now', () => {
    // Mismo día, now = 14:00 Santiago, leadTime = 120 min => cutoff 16:00 Santiago
    const today = new Date('2026-05-20T04:00:00Z')
    const now = new Date('2026-05-20T18:00:00Z') // 14:00 Santiago

    const localRules = [
      { dayOfWeek: 3, startTime: '09:00', endTime: '18:00', isActive: true },
    ]

    const slots = generateSlots(today, 60, localRules, [], [], {
      timezone,
      now,
      leadTimeMinutes: 120,
    })

    // Solo 16:00 y 17:00 Santiago quedan (20:00Z y 21:00Z)
    expect(slots.length).toBe(2)
    expect(slots[0].start.toISOString()).toBe('2026-05-20T20:00:00.000Z')
    expect(slots[1].start.toISOString()).toBe('2026-05-20T21:00:00.000Z')
  })

  it('returns empty when date is outside bookingWindowDays', () => {
    const futureDate = new Date('2026-08-20T04:00:00Z') // 100+ días después de testNow
    const slots = generateSlots(futureDate, 60, rules, [], [], {
      timezone,
      now: testNow,
      bookingWindowDays: 30,
    })
    expect(slots.length).toBe(0)
  })

  it('excludes expired bookings from slot generation', () => {
    const bookings = [
      {
        startDateTime: new Date('2026-05-11T14:00:00Z'),
        endDateTime: new Date('2026-05-11T15:00:00Z'),
        status: 'expired',
      },
    ]
    const slots = generateSlots(baseDate, 60, rules, [], bookings, { timezone, now: testNow })
    const hasSlotAt10 = slots.some((s) => s.start.toISOString() === '2026-05-11T14:00:00.000Z')
    expect(hasSlotAt10).toBe(true)
  })
})
