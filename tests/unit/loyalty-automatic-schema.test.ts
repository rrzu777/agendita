import { describe, it, expect } from 'vitest'
import { automaticRuleSchema, AUTOMATIC_KINDS } from '@/lib/loyalty/schema'

const base = { kind: 'birthday', isActive: true, priority: 0,
  rewardKind: 'points', rewardPoints: 100,
  rewardType: 'percentage', rewardValue: 0, maxDiscount: null, appliesToAll: true, serviceIds: [],
  grantExpiryDays: null, windowDays: 7, inactivityDays: 90, cooldownDays: 180, beneficiary: 'both' }

describe('automaticRuleSchema', () => {
  it('expone los 6 kinds', () => {
    expect(AUTOMATIC_KINDS).toEqual(['birthday','first_visit','review','anniversary','winback','referral'])
  })
  it('reward points: exige rewardPoints > 0 y deja la rama grant en null', () => {
    const r = automaticRuleSchema.parse(base)
    expect(r.rewardPoints).toBe(100)
    expect(r.rewardType).toBeNull()
  })
  it('reward grant: exige rewardType/value y deja rewardPoints en null', () => {
    const r = automaticRuleSchema.parse({ ...base, rewardKind: 'grant', rewardPoints: null,
      rewardType: 'percentage', rewardValue: 20 })
    expect(r.rewardPoints).toBeNull()
    expect(r.rewardType).toBe('percentage')
    expect(r.rewardValue).toBe(20)
  })
  it('rechaza porcentaje fuera de 1..100 en rama grant', () => {
    expect(() => automaticRuleSchema.parse({ ...base, rewardKind: 'grant', rewardPoints: null,
      rewardType: 'percentage', rewardValue: 200 })).toThrow()
  })
  it('grant free_service fuerza rewardValue 0', () => {
    const r = automaticRuleSchema.parse({ ...base, rewardKind: 'grant', rewardPoints: null,
      rewardType: 'free_service', rewardValue: 999, appliesToAll: false, serviceIds: ['s1'] })
    expect(r.rewardValue).toBe(0)
  })
  it('winback exige inactivityDays > 0', () => {
    expect(() => automaticRuleSchema.parse({ ...base, kind: 'winback', inactivityDays: 0 })).toThrow()
  })
})
