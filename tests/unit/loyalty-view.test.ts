import { describe, it, expect } from 'vitest'
import { loyaltyReasonLabel, displayBalance, canAfford } from '@/lib/loyalty/view'

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
