import { describe, it, expect } from 'vitest'
import { isValidTimeRange, timeToMinutes } from '@/lib/availability/time-range'

describe('time-range', () => {
  it('converts HH:MM to minutes', () => {
    expect(timeToMinutes('09:00')).toBe(540)
    expect(timeToMinutes('14:30')).toBe(870)
  })

  it('accepts start < end and rejects start >= end', () => {
    expect(isValidTimeRange('09:00', '18:00')).toBe(true)
    expect(isValidTimeRange('18:00', '09:00')).toBe(false)
    expect(isValidTimeRange('09:00', '09:00')).toBe(false)
  })
})
