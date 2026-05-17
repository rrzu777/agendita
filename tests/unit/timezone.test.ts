import { describe, it, expect } from 'vitest'
import { toBusinessLocalDate } from '@/lib/availability/timezone'

describe('toBusinessLocalDate', () => {
  it('converts UTC Sunday 23:00 to Sunday in America/Santiago', () => {
    // 2026-05-10 23:00 UTC = 2026-05-10 19:00 Santiago (Sunday)
    const utc = new Date('2026-05-10T23:00:00Z')
    const local = toBusinessLocalDate(utc, 'America/Santiago')
    expect(local.getDay()).toBe(0) // Sunday in Santiago
  })

  it('preserves local components for a known Santiago date', () => {
    // 2026-05-11 09:00 UTC = 2026-05-11 05:00 Santiago
    const utc = new Date('2026-05-11T09:00:00Z')
    const local = toBusinessLocalDate(utc, 'America/Santiago')
    expect(local.getHours()).toBe(5)
    expect(local.getDate()).toBe(11)
    expect(local.getMonth()).toBe(4) // May
  })
})
