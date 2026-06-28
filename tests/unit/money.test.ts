import { describe, it, expect } from 'vitest'
import { formatMoney } from '@/lib/money'

describe('formatMoney', () => {
  it('formats CLP without decimals', () => {
    expect(formatMoney(20000, 'CLP')).toBe('$20.000')
  })
  it('formats 0', () => {
    expect(formatMoney(0, 'CLP')).toBe('$0')
  })
  it('falls back to CLP when currency is missing', () => {
    expect(formatMoney(1500)).toBe('$1.500')
  })
  it('formats a 2-decimal currency in minor-agnostic whole units (USD)', () => {
    // A: amounts are whole units; decimals/minor-units son del track E.
    expect(formatMoney(20, 'USD')).toMatch(/\$?20/)
  })
})
