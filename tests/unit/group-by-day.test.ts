import { describe, it, expect } from 'vitest'
import { groupBookingsByDay } from '@/lib/calendar/group-by-day'

describe('groupBookingsByDay', () => {
  it('groups items by local day key using timezone', () => {
    const items = [
      { startDateTime: new Date('2026-05-18T04:00:00Z') }, // 00:00 CLT
      { startDateTime: new Date('2026-05-18T12:00:00Z') }, // 08:00 CLT
      { startDateTime: new Date('2026-05-19T04:00:00Z') }, // 00:00 CLT next day
    ]
    const result = groupBookingsByDay(items, 'America/Santiago')
    expect(Object.keys(result)).toEqual(['2026-05-18', '2026-05-19'])
    expect(result['2026-05-18'].length).toBe(2)
    expect(result['2026-05-19'].length).toBe(1)
  })

  it('returns empty object for empty input', () => {
    expect(groupBookingsByDay([], 'America/Santiago')).toEqual({})
  })
})
