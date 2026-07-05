import { describe, it, expect } from 'vitest'
import { shrinkBlock } from '@/lib/availability/shrink-block'

describe('shrinkBlock', () => {
  const start = new Date('2026-05-11T16:00:00Z') // 12:00 Santiago
  const end = new Date('2026-05-11T18:00:00Z')   // 14:00 Santiago

  it('returns the block untouched with tolerance 0 or undefined', () => {
    expect(shrinkBlock({ startDateTime: start, endDateTime: end })).toEqual({ start, end })
    expect(shrinkBlock({ startDateTime: start, endDateTime: end, overlapToleranceMinutes: 0 })).toEqual({ start, end })
  })

  it('shrinks both edges by the tolerance', () => {
    const r = shrinkBlock({ startDateTime: start, endDateTime: end, overlapToleranceMinutes: 45 })
    expect(r?.start.toISOString()).toBe('2026-05-11T16:45:00.000Z')
    expect(r?.end.toISOString()).toBe('2026-05-11T17:15:00.000Z')
  })

  it('returns null when the tolerance collapses the block', () => {
    expect(shrinkBlock({ startDateTime: start, endDateTime: end, overlapToleranceMinutes: 60 })).toBeNull()
    expect(shrinkBlock({ startDateTime: start, endDateTime: end, overlapToleranceMinutes: 90 })).toBeNull()
  })
})
