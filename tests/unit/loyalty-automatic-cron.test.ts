import { describe, it, expect } from 'vitest'
import { selectTimedRuleForCustomer } from '@/lib/cron/loyalty-automatic'

const TZ = 'America/Santiago'
const now = new Date('2026-06-29T12:00:00Z')
const rule = (kind: string, priority: number, extra: any = {}) => ({
  id: kind, priority, conditions: { kind, windowDays: 0, inactivityDays: 90, cooldownDays: 180, ...extra },
})

describe('selectTimedRuleForCustomer', () => {
  it('elige la regla de mayor prioridad entre las que matchean (cumple gana a winback)', () => {
    const cust = { id: 'c1', birthDate: new Date('1990-06-29'),
      firstCompletedAt: new Date('2024-01-01'), lastCompletedAt: new Date('2026-01-01') }
    const rules = [rule('winback', 1), rule('birthday', 5)]
    const sel = selectTimedRuleForCustomer(rules as any, cust as any, now, TZ)
    expect(sel?.id).toBe('birthday')
  })
  it('devuelve null si ninguna matchea', () => {
    const cust = { id: 'c1', birthDate: new Date('1990-01-01'),
      firstCompletedAt: new Date('2026-06-01'), lastCompletedAt: new Date('2026-06-20') }
    const rules = [rule('birthday', 5), rule('winback', 1)]
    expect(selectTimedRuleForCustomer(rules as any, cust as any, now, TZ)).toBeNull()
  })
})
