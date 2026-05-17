import { describe, it, expect } from 'vitest'
import { generateSlots } from '@/lib/availability/slots'

describe('generateSlots', () => {
  const baseDate = new Date('2026-05-11T00:00:00') // Monday UTC

  const rules = [
    { dayOfWeek: 1, startTime: '09:00', endTime: '18:00', isActive: true },
  ]

  it('generates slots for a normal day', () => {
    const slots = generateSlots(baseDate, 60, rules, [], [], { timezone: 'UTC' })
    expect(slots.length).toBeGreaterThan(0)
    expect(slots[0].start.getHours()).toBe(9)
  })

  it('respects availability rules', () => {
    const slots = generateSlots(baseDate, 60, rules, [], [], { timezone: 'UTC' })
    const lastSlot = slots[slots.length - 1]
    expect(lastSlot.end.getHours()).toBeLessThanOrEqual(18)
  })

  it('excludes blocked time', () => {
    const blocks = [
      {
        startDateTime: new Date('2026-05-11T12:00:00'),
        endDateTime: new Date('2026-05-11T13:00:00'),
      },
    ]
    const slots = generateSlots(baseDate, 60, rules, blocks, [], { timezone: 'UTC' })
    const hasSlotAt12 = slots.some((s) => s.start.getHours() === 12)
    expect(hasSlotAt12).toBe(false)
  })

  it('excludes existing bookings', () => {
    const bookings = [
      {
        startDateTime: new Date('2026-05-11T10:00:00'),
        endDateTime: new Date('2026-05-11T11:00:00'),
        status: 'confirmed',
      },
    ]
    const slots = generateSlots(baseDate, 60, rules, [], bookings, { timezone: 'UTC' })
    const hasSlotAt10 = slots.some((s) => s.start.getHours() === 10)
    expect(hasSlotAt10).toBe(false)
  })

  it('allows cancelled bookings to be rebooked', () => {
    const bookings = [
      {
        startDateTime: new Date('2026-05-11T10:00:00'),
        endDateTime: new Date('2026-05-11T11:00:00'),
        status: 'cancelled',
      },
    ]
    const slots = generateSlots(baseDate, 60, rules, [], bookings, { timezone: 'UTC' })
    const hasSlotAt10 = slots.some((s) => s.start.getHours() === 10)
    expect(hasSlotAt10).toBe(true)
  })

  it('filters past slots when date is today', () => {
    // Fechas fijas con Z para determinismo con timezone UTC
    const today = new Date('2026-05-20T00:00:00Z')
    const now = new Date('2026-05-20T14:00:00Z')

    const localRules = [
      { dayOfWeek: 3, startTime: '09:00', endTime: '18:00', isActive: true },
    ]

    const slots = generateSlots(today, 60, localRules, [], [], { timezone: 'UTC', now })
    const hasMorningSlot = slots.some((s) => s.start.getHours() < 14)
    expect(hasMorningSlot).toBe(false)
    expect(slots.length).toBeGreaterThan(0)
  })

  it('respects timezone for dayOfWeek calculation', () => {
    // UTC Sunday 23:00 = Sunday 19:00 in America/Santiago
    const utcSundayLate = new Date('2026-05-10T23:00:00Z')
    const santiagoRules = [
      { dayOfWeek: 0, startTime: '09:00', endTime: '18:00', isActive: true },
    ]
    const slots = generateSlots(utcSundayLate, 60, santiagoRules, [], [], { timezone: 'America/Santiago' })
    expect(slots.length).toBeGreaterThan(0)
    expect(slots[0].start.getHours()).toBe(9)
  })

  it('uses step increment equal to durationMinutes', () => {
    const slots = generateSlots(baseDate, 90, rules, [], [], { timezone: 'UTC' })
    expect(slots.length).toBe(6) // 09:00 to 16:30 = 6 slots of 90min
    expect(slots[0].start.getHours()).toBe(9)
    expect(slots[1].start.getHours()).toBe(10)
    expect(slots[1].start.getMinutes()).toBe(30)
  })
})
