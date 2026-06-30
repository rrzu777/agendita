import { describe, it, expect } from 'vitest'
import {
  matchesBirthday, matchesAnniversary, isWinbackInactive,
  occasionKey, firstVisitKey, reviewKey, referralKey, sortByPriorityDesc,
} from '@/lib/loyalty/automatic-match'

const TZ = 'America/Santiago'
const d = (s: string) => new Date(s)

describe('matchers temporales', () => {
  it('cumpleaños: matchea el día exacto en la TZ del negocio', () => {
    expect(matchesBirthday(d('1990-06-29'), d('2026-06-29T12:00:00Z'), TZ, 0)).toBe(true)
    expect(matchesBirthday(d('1990-06-28'), d('2026-06-29T12:00:00Z'), TZ, 0)).toBe(false)
  })
  it('cumpleaños: respeta la ventana ±windowDays', () => {
    expect(matchesBirthday(d('1990-07-02'), d('2026-06-29T12:00:00Z'), TZ, 7)).toBe(true)
    expect(matchesBirthday(d('1990-07-10'), d('2026-06-29T12:00:00Z'), TZ, 7)).toBe(false)
  })
  it('cumpleaños: null => false', () => {
    expect(matchesBirthday(null, d('2026-06-29T12:00:00Z'), TZ, 7)).toBe(false)
  })
  it('aniversario: usa mes/día de firstCompletedAt', () => {
    expect(matchesAnniversary(d('2025-06-29T10:00:00Z'), d('2026-06-29T12:00:00Z'), TZ, 0)).toBe(true)
    expect(matchesAnniversary(d('2025-06-01T10:00:00Z'), d('2026-06-29T12:00:00Z'), TZ, 0)).toBe(false)
  })
  it('winback: inactiva si la última completada es más vieja que inactivityDays', () => {
    expect(isWinbackInactive(d('2026-01-01T00:00:00Z'), d('2026-06-29T00:00:00Z'), 90)).toBe(true)
    expect(isWinbackInactive(d('2026-06-01T00:00:00Z'), d('2026-06-29T00:00:00Z'), 90)).toBe(false)
    expect(isWinbackInactive(null, d('2026-06-29T00:00:00Z'), 90)).toBe(false)
  })
})

describe('keys', () => {
  it('occasionKey es por (clienta, día local)', () => {
    expect(occasionKey('c1', d('2026-06-29T12:00:00Z'), TZ)).toBe('c1:2026-06-29:auto-timed')
  })
  it('keys de evento', () => {
    expect(firstVisitKey('c1')).toBe('c1:first_visit')
    expect(reviewKey('c1', 'b9')).toBe('c1:review:b9')
    expect(referralKey('c2')).toBe('c2:referral')
  })
  it('sortByPriorityDesc ordena mayor prioridad primero', () => {
    const out = sortByPriorityDesc([{ priority: 1 }, { priority: 5 }, { priority: 3 }] as any)
    expect(out.map((r: any) => r.priority)).toEqual([5, 3, 1])
  })
})
