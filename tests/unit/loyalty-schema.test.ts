import { describe, it, expect } from 'vitest'
import { loyaltyConfigSchema, adjustPointsSchema } from '@/lib/loyalty/schema'

describe('loyaltyConfigSchema', () => {
  const base = { isActive: true, programName: 'Puntos X', pointsLabel: 'estrellas', pointsPerVisit: 10, spendPerPoint: 1000, minSpendToEarn: null, cardMessage: null }
  it('acepta config válida', () => {
    expect(loyaltyConfigSchema.safeParse(base).success).toBe(true)
  })
  it('pointsLabel default = "puntos"', () => {
    const { pointsLabel } = loyaltyConfigSchema.parse({ ...base, pointsLabel: undefined })
    expect(pointsLabel).toBe('puntos')
  })
  it('programName vacío falla', () => {
    expect(loyaltyConfigSchema.safeParse({ ...base, programName: '   ' }).success).toBe(false)
  })
  it('pointsPerVisit negativo falla', () => {
    expect(loyaltyConfigSchema.safeParse({ ...base, pointsPerVisit: -1 }).success).toBe(false)
  })
  it('spendPerPoint 0 o negativo se normaliza a null', () => {
    expect(loyaltyConfigSchema.parse({ ...base, spendPerPoint: 0 }).spendPerPoint).toBeNull()
  })
  it('cardMessage vacío => null', () => {
    expect(loyaltyConfigSchema.parse({ ...base, cardMessage: '  ' }).cardMessage).toBeNull()
  })
})

describe('adjustPointsSchema', () => {
  it('acepta delta no-cero con nota', () => {
    expect(adjustPointsSchema.safeParse({ delta: -50, note: 'cortesía' }).success).toBe(true)
  })
  it('delta 0 falla', () => {
    expect(adjustPointsSchema.safeParse({ delta: 0, note: 'x' }).success).toBe(false)
  })
  it('nota vacía falla', () => {
    expect(adjustPointsSchema.safeParse({ delta: 10, note: '' }).success).toBe(false)
  })
})
