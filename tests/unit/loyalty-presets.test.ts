import { describe, it, expect } from 'vitest'
import { loyaltyConfigSchema, redemptionOptionSchema, automaticRuleSchema } from '@/lib/loyalty/schema'
import {
  PRESETS, buildPresetPayload, planPresetApply, redemptionSignature,
  summarizeApply, presetCatalog, type CurrentLoyaltyState,
} from '@/lib/loyalty/presets'

const cleanState: CurrentLoyaltyState = { config: null, existingRuleKinds: [], existingRedemptionSignatures: [] }

describe('catálogo de presets', () => {
  for (const p of PRESETS) {
    it(`${p.id}: produce un payload válido contra los schemas`, () => {
      const payload = buildPresetPayload(p.id)
      if (payload.config) {
        expect(loyaltyConfigSchema.safeParse({ ...payload.config, isActive: true, programName: 'X' }).success).toBe(true)
      }
      for (const o of payload.redemptionOptions) expect(redemptionOptionSchema.safeParse(o).success).toBe(true)
      for (const r of payload.rules) expect(automaticRuleSchema.safeParse(r).success).toBe(true)
    })
  }

  it('recommended-program: un solo base, kinds únicos, config presente', () => {
    const payload = buildPresetPayload('recommended-program')
    expect(payload.config).not.toBeNull()
    const kinds = payload.rules.map((r) => r.kind)
    expect(new Set(kinds).size).toBe(kinds.length)
    expect(kinds).toContain('birthday')
    expect(kinds).toContain('referral')
  })

  it('buildPresetPayload lanza con id inexistente', () => {
    expect(() => buildPresetPayload('nope')).toThrow()
  })

  it('describe coincide con el payload (guard anti-drift)', () => {
    const stamp = PRESETS.find((x) => x.id === 'stamp-card')!.describe.join(' ')
    expect(stamp).toContain('1 sello')
    expect(stamp).toContain('10 sellos')
    const bday = PRESETS.find((x) => x.id === 'birthday')!.describe.join(' ')
    expect(bday).toContain('20%')
  })
})

describe('planPresetApply — aditivo e idempotente', () => {
  it('estado limpio: siembra config, reglas y canje', () => {
    const plan = planPresetApply(buildPresetPayload('recommended-program'), cleanState)
    expect(plan.configToWrite).toMatchObject({ pointsLabel: 'sellos', pointsPerVisit: 1, isActive: true })
    expect(plan.configToWrite?.programName).toBe('Programa de fidelidad')
    expect(plan.rulesToCreate.map((r) => r.kind).sort()).toEqual(['birthday', 'referral'])
    expect(plan.redemptionsToCreate).toHaveLength(1)
  })

  it('kind existente (activo o archivado) se saltea, no se resucita', () => {
    const plan = planPresetApply(buildPresetPayload('recommended-program'), { ...cleanState, existingRuleKinds: ['birthday'] })
    expect(plan.rulesToCreate.map((r) => r.kind)).toEqual(['referral'])
    expect(plan.skipped.rules).toContain('birthday')
  })

  it('redemption de firma equivalente se saltea', () => {
    const sig = redemptionSignature({ rewardType: 'free_service', rewardValue: 0, pointsCost: 10, appliesToAll: true })
    const plan = planPresetApply(buildPresetPayload('stamp-card'), { ...cleanState, existingRedemptionSignatures: [sig] })
    expect(plan.redemptionsToCreate).toHaveLength(0)
    expect(plan.skipped.redemptions).toContain('Servicio gratis')
  })

  it('config previa: pisa earn scalars, preserva programName', () => {
    const plan = planPresetApply(buildPresetPayload('stamp-card'), {
      config: { pointsLabel: 'puntos', pointsPerVisit: 10, spendPerPoint: null, minSpendToEarn: null, programName: 'Mi club' },
      existingRuleKinds: [], existingRedemptionSignatures: [],
    })
    expect(plan.configToWrite).toMatchObject({ pointsLabel: 'sellos', pointsPerVisit: 1, programName: 'Mi club', isActive: true })
  })

  it('base-sobre-base: crea la segunda redemption (firma distinta)', () => {
    const stampSig = redemptionSignature({ rewardType: 'free_service', rewardValue: 0, pointsCost: 10, appliesToAll: true })
    const plan = planPresetApply(buildPresetPayload('points-per-visit'), { ...cleanState, existingRedemptionSignatures: [stampSig] })
    expect(plan.redemptionsToCreate).toHaveLength(1)
  })

  it('re-aplicar el mismo preset es idempotente', () => {
    const payload = buildPresetPayload('recommended-program')
    const first = planPresetApply(payload, cleanState)
    const state: CurrentLoyaltyState = {
      config: { ...first.configToWrite! },
      existingRuleKinds: first.rulesToCreate.map((r) => r.kind),
      existingRedemptionSignatures: first.redemptionsToCreate.map((o) =>
        redemptionSignature({ rewardType: o.rewardType, rewardValue: Number(o.rewardValue), pointsCost: Number(o.pointsCost), appliesToAll: o.appliesToAll })),
    }
    const second = planPresetApply(payload, state)
    expect(second.rulesToCreate).toHaveLength(0)
    expect(second.redemptionsToCreate).toHaveLength(0)
  })
})

describe('summarizeApply / presetCatalog', () => {
  it('summarizeApply lista aplicados y salteados', () => {
    const plan = planPresetApply(buildPresetPayload('recommended-program'), { ...cleanState, existingRuleKinds: ['birthday'] })
    const s = summarizeApply(plan)
    expect(s.applied).toContain('Referidas')
    expect(s.skipped).toContain('Cumpleaños')
  })

  it('presetCatalog expone metadata de display', () => {
    const cat = presetCatalog()
    expect(cat.find((c) => c.id === 'stamp-card')?.name).toBe('Tarjeta de sellos')
    expect(cat.every((c) => Array.isArray(c.describe))).toBe(true)
  })
})
