import { describe, it, expect } from 'vitest'
import { redemptionOptionSchema, redeemSchema, loyaltyConfigSchema } from '@/lib/loyalty/schema'

describe('redemptionOptionSchema', () => {
  const base = { name: 'Servicio gratis', rewardType: 'free_service', rewardValue: 0,
    pointsCost: 100, appliesToAll: true }
  it('acepta una opción válida y fuerza rewardValue 0 en free_service', () => {
    const r = redemptionOptionSchema.parse({ ...base, rewardValue: 99 })
    expect(r.rewardValue).toBe(0)
    expect(r.pointsCost).toBe(100)
    expect(r.isActive).toBe(true)
  })
  it('rechaza pointsCost <= 0', () => {
    expect(redemptionOptionSchema.safeParse({ ...base, pointsCost: 0 }).success).toBe(false)
  })
  it('rechaza percentage fuera de 1..100', () => {
    expect(redemptionOptionSchema.safeParse({ ...base, rewardType: 'percentage', rewardValue: 150 }).success).toBe(false)
  })
  it('exige al menos un servicio si no aplica a todos', () => {
    expect(redemptionOptionSchema.safeParse({ ...base, appliesToAll: false, serviceIds: [] }).success).toBe(false)
  })
})

describe('redeemSchema', () => {
  it('exige optionId y requestId', () => {
    expect(redeemSchema.safeParse({ optionId: 'p1', requestId: 'r1' }).success).toBe(true)
    expect(redeemSchema.safeParse({ optionId: '', requestId: 'r1' }).success).toBe(false)
  })
})

describe('loyaltyConfigSchema (B2)', () => {
  it('default refundPointsOnExpiry=true, forfeitGrantOnNoShow=false', () => {
    const r = loyaltyConfigSchema.parse({ isActive: true, programName: 'X', pointsPerVisit: 1 })
    expect(r.refundPointsOnExpiry).toBe(true)
    expect(r.forfeitGrantOnNoShow).toBe(false)
  })
})
