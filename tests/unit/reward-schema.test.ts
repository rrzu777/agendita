import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { withRewardRules, REWARD_TYPES } from '@/lib/rewards/schema'

const base = withRewardRules(
  z
    .object({
      rewardType: z.enum(REWARD_TYPES),
      rewardValue: z.coerce.number().int().nonnegative(),
      appliesToAll: z.boolean(),
      serviceIds: z.array(z.string()).optional().default([]),
    })
    .strip(),
)

describe('withRewardRules', () => {
  it('free_service fuerza rewardValue a 0', () => {
    const r = base.parse({ rewardType: 'free_service', rewardValue: 999, appliesToAll: true })
    expect(r.rewardValue).toBe(0)
  })

  it('rechaza porcentaje fuera de 1–100 (path rewardValue)', () => {
    const r = base.safeParse({ rewardType: 'percentage', rewardValue: 0, appliesToAll: true })
    expect(r.success).toBe(false)
    if (!r.success) expect(r.error.issues[0].path).toEqual(['rewardValue'])
  })

  it('acepta porcentaje válido', () => {
    const r = base.safeParse({ rewardType: 'percentage', rewardValue: 50, appliesToAll: true })
    expect(r.success).toBe(true)
  })

  it('exige servicios cuando no aplica a todos (path serviceIds)', () => {
    const r = base.safeParse({ rewardType: 'fixed_amount', rewardValue: 1000, appliesToAll: false, serviceIds: [] })
    expect(r.success).toBe(false)
    if (!r.success) expect(r.error.issues[0].path).toEqual(['serviceIds'])
  })

  it('REWARD_TYPES son los tres tipos', () => {
    expect(REWARD_TYPES).toEqual(['percentage', 'fixed_amount', 'free_service'])
  })
})
