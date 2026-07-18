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

describe('occasionKey por ocasión-año (cumpleaños/aniversario)', () => {
  const bdayRule = { conditions: { kind: 'birthday', windowDays: 30 } } as any
  const annivRule = { conditions: { kind: 'anniversary', windowDays: 30 } } as any
  const winbackRule = { conditions: { kind: 'winback', inactivityDays: 90 } } as any
  const cust = (over: any) => ({ id: 'c1', birthDate: null, firstCompletedAt: null, ...over })

  it('cumpleaños: todos los días de la ventana comparten la misma key (año de la instancia)', () => {
    const c = cust({ birthDate: d('1990-07-02') })
    const k1 = occasionKey(bdayRule, c, d('2026-06-29T12:00:00Z'), TZ) // 3 días antes del cumple
    const k2 = occasionKey(bdayRule, c, d('2026-07-20T12:00:00Z'), TZ) // 18 días después
    expect(k1).toBe('c1:birthday:2026')
    expect(k2).toBe(k1)
  })
  it('cumpleaños: años distintos => keys distintas (se premia cada año)', () => {
    const c = cust({ birthDate: d('1990-07-02') })
    expect(occasionKey(bdayRule, c, d('2027-07-02T12:00:00Z'), TZ)).toBe('c1:birthday:2027')
  })
  it('cumpleaños: la ventana que cruza fin de año cae en el año de la instancia', () => {
    const c = cust({ birthDate: d('1990-01-05') })
    const kDec = occasionKey(bdayRule, c, d('2026-12-20T12:00:00Z'), TZ) // apunta al cumple del 5-ene-2027
    const kJan = occasionKey(bdayRule, c, d('2027-01-03T12:00:00Z'), TZ)
    expect(kDec).toBe('c1:birthday:2027')
    expect(kJan).toBe(kDec)
  })
  it('aniversario: mes/día de firstCompletedAt + año de la instancia', () => {
    const c = cust({ firstCompletedAt: d('2025-06-29T10:00:00Z') })
    expect(occasionKey(annivRule, c, d('2026-06-29T12:00:00Z'), TZ)).toBe('c1:anniversary:2026')
  })
  it('winback: sigue siendo por (clienta, día local) — R-WINBACK controla la re-elegibilidad', () => {
    const c = cust({ lastCompletedAt: d('2026-01-01') })
    expect(occasionKey(winbackRule, c, d('2026-06-29T12:00:00Z'), TZ)).toBe('c1:2026-06-29:auto-timed')
  })
})

describe('keys', () => {
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
