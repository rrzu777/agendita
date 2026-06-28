import { describe, it, expect } from 'vitest'
import { createPromotionSchema, normalizeCode } from '@/lib/promotions/schema'

const base = {
  name: 'Verano',
  rewardType: 'percentage' as const,
  rewardValue: 20,
  appliesToAll: true,
}

describe('normalizeCode', () => {
  it('uppercases and trims', () => {
    expect(normalizeCode('  verano20 ')).toBe('VERANO20')
  })
  it('returns null for empty', () => {
    expect(normalizeCode('')).toBeNull()
    expect(normalizeCode(null)).toBeNull()
  })
})

describe('createPromotionSchema', () => {
  it('accepts a valid percentage promo and normalizes the code', () => {
    const r = createPromotionSchema.safeParse({ ...base, code: 'verano20' })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.code).toBe('VERANO20')
  })
  it('rejects percentage > 100', () => {
    expect(createPromotionSchema.safeParse({ ...base, rewardValue: 120 }).success).toBe(false)
  })
  it('rejects negative fixed amount', () => {
    expect(createPromotionSchema.safeParse({ ...base, rewardType: 'fixed_amount', rewardValue: -1 }).success).toBe(false)
  })
  it('rejects validUntil before validFrom', () => {
    const r = createPromotionSchema.safeParse({ ...base, validFrom: '2026-07-10', validUntil: '2026-07-01' })
    expect(r.success).toBe(false)
  })
  it('requires services when appliesToAll is false', () => {
    const r = createPromotionSchema.safeParse({ ...base, appliesToAll: false, serviceIds: [] })
    expect(r.success).toBe(false)
  })
  it('free_service forces rewardValue 0', () => {
    const r = createPromotionSchema.safeParse({ ...base, rewardType: 'free_service', rewardValue: 999 })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.rewardValue).toBe(0)
  })
})
