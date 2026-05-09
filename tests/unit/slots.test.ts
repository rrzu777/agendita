import { describe, it, expect } from 'vitest'
import { generateSlots } from '@/lib/availability/slots'

describe('generateSlots', () => {
  const baseDate = new Date('2026-05-11T00:00:00') // Monday
  
  const rules = [
    { dayOfWeek: 1, startTime: '09:00', endTime: '18:00', isActive: true },
  ]
  
  it('generates slots for a normal day', () => {
    const slots = generateSlots(baseDate, 60, rules, [], [])
    expect(slots.length).toBeGreaterThan(0)
    expect(slots[0].start.getHours()).toBe(9)
  })
  
  it('respects availability rules', () => {
    const slots = generateSlots(baseDate, 60, rules, [], [])
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
    const slots = generateSlots(baseDate, 60, rules, blocks, [])
    const hasSlotAt12 = slots.some(s => s.start.getHours() === 12)
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
    const slots = generateSlots(baseDate, 60, rules, [], bookings)
    const hasSlotAt10 = slots.some(s => s.start.getHours() === 10)
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
    const slots = generateSlots(baseDate, 60, rules, [], bookings)
    const hasSlotAt10 = slots.some(s => s.start.getHours() === 10)
    expect(hasSlotAt10).toBe(true)
  })
})
