import { describe, expect, it } from 'vitest'
import { generateSlots, generateSlotsResult } from '@/lib/availability/slots'
const day = new Date('2026-08-31T12:00:00Z')
const rules = [{ dayOfWeek: 1, startTime: '09:00', endTime: '11:00', isActive: true }]
const options = { timezone: 'UTC', now: new Date('2026-08-30T00:00:00Z'), leadTimeMinutes: 120 }
describe('availability diagnosis from the same slot calculation', () => {
  it('preserves legacy slots exactly', () => {
    expect(generateSlotsResult(day, 30, rules, [], [], options)).toEqual({ slots: generateSlots(day, 30, rules, [], [], options), emptyReason: null })
  })
  it.each([
    ['outside_booking_window', { ...options, bookingWindowDays: 0 }],
    ['lead_time_restricted', { ...options, now: new Date('2026-08-31T10:00:00Z') }],
  ])('proves %s without inspecting UI error text', (reason, opts) => {
    expect(generateSlotsResult(day, 30, rules, [], [], opts as typeof options).emptyReason).toBe(reason)
  })
  it('separates no offering, exhausted capacity and mixed causes', () => {
    expect(generateSlotsResult(day, 30, [], [], [], options).emptyReason).toBe('not_offered')
    const blocks = [{ startDateTime: new Date('2026-08-31T09:00:00Z'), endDateTime: new Date('2026-08-31T11:00:00Z') }]
    expect(generateSlotsResult(day, 30, rules, blocks, [], options).emptyReason).toBe('no_capacity')
    expect(generateSlotsResult(day, 30, rules, blocks, [], { ...options, now: new Date('2026-08-31T10:00:00Z') }).emptyReason).toBe('unknown')
  })
})
