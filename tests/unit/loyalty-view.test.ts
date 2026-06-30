import { describe, it, expect } from 'vitest'
import { loyaltyReasonLabel, displayBalance, canAfford, describeReward } from '@/lib/loyalty/view'

describe('loyaltyReasonLabel', () => {
  it('mapea cada motivo', () => {
    expect(loyaltyReasonLabel('visit')).toBe('Visita')
    expect(loyaltyReasonLabel('visit_reversal')).toBe('Reembolso')
    expect(loyaltyReasonLabel('adjustment')).toBe('Ajuste')
  })
})

describe('displayBalance', () => {
  it('nunca muestra negativo', () => {
    expect(displayBalance(-30)).toBe(0)
    expect(displayBalance(120)).toBe(120)
  })
})

describe('loyaltyReasonLabel (B2)', () => {
  it('etiqueta canje y reembolso de canje', () => {
    expect(loyaltyReasonLabel('redemption')).toBe('Canje')
    expect(loyaltyReasonLabel('redemption_reversal')).toBe('Reembolso de canje')
  })
})

describe('canAfford', () => {
  it('true si el saldo alcanza el costo', () => {
    expect(canAfford(100, 80)).toBe(true)
    expect(canAfford(80, 80)).toBe(true)
  })
  it('false si no alcanza', () => {
    expect(canAfford(79, 80)).toBe(false)
  })
})

describe('describeReward', () => {
  it('null cuando no se emitió nada', () => {
    expect(describeReward(null, { rewardType: 'percentage', rewardValue: 20 }, 'puntos', 'CLP')).toBeNull()
  })

  it('puntos usan el pointsLabel del config', () => {
    const reward = { kind: 'points' as const, points: 150, ledgerId: 'l1' }
    expect(describeReward(reward, { rewardType: null, rewardValue: 0 }, 'estrellas', 'CLP')).toBe('150 estrellas')
    expect(describeReward(reward, { rewardType: null, rewardValue: 0 }, 'puntos', 'CLP')).toBe('150 puntos')
  })

  it('grant percentage', () => {
    const grant = { kind: 'grant' as const, grantId: 'g1', code: 'ABC' }
    expect(describeReward(grant, { rewardType: 'percentage', rewardValue: 20 }, 'puntos', 'CLP')).toBe('un 20% de descuento')
  })

  it('grant fixed_amount es currency-clean (CLP sin decimales)', () => {
    const grant = { kind: 'grant' as const, grantId: 'g1', code: 'ABC' }
    const label = describeReward(grant, { rewardType: 'fixed_amount', rewardValue: 5000 }, 'puntos', 'CLP')
    expect(label).toContain('un descuento de')
    expect(label).toContain('5.000')
    expect(label).not.toContain('5.000,00')
  })

  it('grant fixed_amount con moneda de 2 decimales', () => {
    const grant = { kind: 'grant' as const, grantId: 'g1', code: 'ABC' }
    const label = describeReward(grant, { rewardType: 'fixed_amount', rewardValue: 50 }, 'puntos', 'USD')
    expect(label).toContain('50')
  })

  it('grant free_service', () => {
    const grant = { kind: 'grant' as const, grantId: 'g1', code: 'ABC' }
    expect(describeReward(grant, { rewardType: 'free_service', rewardValue: 0 }, 'puntos', 'CLP')).toBe('un servicio gratis')
  })
})
