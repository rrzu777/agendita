import { describe, it, expect } from 'vitest'
import { loyaltyReasonLabel, displayBalance } from '@/lib/loyalty/view'

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
