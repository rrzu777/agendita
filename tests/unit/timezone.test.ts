import { describe, it, expect } from 'vitest'
import { getLocalDateStr, getLocalDayOfWeek, getLocalTimeStr } from '@/lib/availability/timezone'

describe('timezone helpers', () => {
  it('getLocalDateStr returns correct local date in America/Santiago', () => {
    // 2026-05-10 23:00 UTC = 2026-05-10 19:00 Santiago
    const utc = new Date('2026-05-10T23:00:00Z')
    expect(getLocalDateStr(utc, 'America/Santiago')).toBe('2026-05-10')
  })

  it('getLocalDateStr crosses day boundary for late UTC', () => {
    // 2026-05-11 03:00 UTC = 2026-05-10 23:00 Santiago
    const utc = new Date('2026-05-11T03:00:00Z')
    expect(getLocalDateStr(utc, 'America/Santiago')).toBe('2026-05-10')
  })

  it('getLocalDayOfWeek returns Sunday for late Sunday UTC in Santiago', () => {
    // 2026-05-11 01:00 UTC = 2026-05-10 21:00 Santiago (Sunday)
    const utc = new Date('2026-05-11T01:00:00Z')
    expect(getLocalDayOfWeek(utc, 'America/Santiago')).toBe(0)
  })

  it('getLocalDayOfWeek returns Monday for Monday morning UTC in Santiago', () => {
    // 2026-05-11 14:00 UTC = 2026-05-11 10:00 Santiago (Monday)
    const utc = new Date('2026-05-11T14:00:00Z')
    expect(getLocalDayOfWeek(utc, 'America/Santiago')).toBe(1)
  })

  it('getLocalTimeStr returns correct local time', () => {
    // 2026-05-11 09:00 UTC = 2026-05-11 05:00 Santiago
    const utc = new Date('2026-05-11T09:00:00Z')
    expect(getLocalTimeStr(utc, 'America/Santiago')).toBe('05:00')
  })
})
