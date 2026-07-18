import { describe, it, expect } from 'vitest'
import { getLocalDateStr, getLocalDayOfWeek, getLocalTimeStr, getBusinessDayRange, startOfLocalMonth } from '@/lib/availability/timezone'

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

  it('getBusinessDayRange returns correct UTC bounds for America/Santiago', () => {
    // 2026-05-20T04:00:00Z = 00:00 local del 20 en Santiago
    const utc = new Date('2026-05-20T04:00:00Z')
    const { dayStart, dayEnd } = getBusinessDayRange(utc, 'America/Santiago')

    expect(dayStart.toISOString()).toBe('2026-05-20T04:00:00.000Z')
    expect(dayEnd.toISOString()).toBe('2026-05-21T03:59:59.999Z')
  })

  it('getBusinessDayRange includes a late-evening booking in Santiago', () => {
    // Un booking a las 21:00 Santiago del 20 = 2026-05-21T01:00:00Z
    const utc = new Date('2026-05-20T04:00:00Z')
    const { dayStart, dayEnd } = getBusinessDayRange(utc, 'America/Santiago')

    const lateBooking = new Date('2026-05-21T01:00:00Z')
    expect(lateBooking >= dayStart && lateBooking <= dayEnd).toBe(true)
  })

  describe('startOfLocalMonth', () => {
    it('returns the UTC instant of the 1st at 00:00 local (Santiago)', () => {
      // Mediados de mayo local → inicio de mayo local = 2026-05-01T00:00 Santiago = 04:00Z
      const utc = new Date('2026-05-15T12:00:00Z')
      expect(startOfLocalMonth(utc, 'America/Santiago').toISOString()).toBe('2026-05-01T04:00:00.000Z')
    })

    it('uses the LOCAL month, not the UTC month, near midnight of the 1st', () => {
      // 2026-06-01T02:00:00Z todavía es 2026-05-31 22:00 en Santiago → mes local = mayo
      const utc = new Date('2026-06-01T02:00:00Z')
      expect(startOfLocalMonth(utc, 'America/Santiago').toISOString()).toBe('2026-05-01T04:00:00.000Z')
    })

    it('an income instant just after local month start is inside the window', () => {
      const now = new Date('2026-06-01T02:00:00Z') // 31 mayo 22:00 local
      const monthStart = startOfLocalMonth(now, 'America/Santiago') // inicio de mayo local
      const earlyMay = new Date('2026-05-01T05:00:00Z') // 1 mayo 01:00 local
      expect(earlyMay >= monthStart).toBe(true)
    })
  })
})
