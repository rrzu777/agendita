import { describe, it, expect } from 'vitest'
import { computeEarnedPoints } from '@/lib/loyalty/earn'

const cfg = (over = {}) => ({ pointsPerVisit: 10, spendPerPoint: 1000, minSpendToEarn: null, ...over })

describe('computeEarnedPoints', () => {
  it('suma puntos por visita + por gasto (floor)', () => {
    const r = computeEarnedPoints(cfg(), { finalAmount: 16500 })
    expect(r.pointsPerVisit).toBe(10)
    expect(r.pointsFromSpend).toBe(16) // floor(16500/1000)
    expect(r.total).toBe(26)
    expect(r.belowMinSpend).toBe(false)
  })
  it('solo por visita cuando spendPerPoint es null', () => {
    expect(computeEarnedPoints(cfg({ spendPerPoint: null }), { finalAmount: 16500 }).total).toBe(10)
  })
  it('solo por gasto cuando pointsPerVisit es 0', () => {
    expect(computeEarnedPoints(cfg({ pointsPerVisit: 0 }), { finalAmount: 2000 }).total).toBe(2)
  })
  it('reserva gratis sin piso igual da puntos por visita', () => {
    expect(computeEarnedPoints(cfg(), { finalAmount: 0 }).total).toBe(10)
  })
  it('spendPerPoint 0 se trata como off', () => {
    expect(computeEarnedPoints(cfg({ spendPerPoint: 0 }), { finalAmount: 5000 }).total).toBe(10)
  })
  it('bajo el piso no acredita nada (ni visita ni gasto)', () => {
    const r = computeEarnedPoints(cfg({ minSpendToEarn: 10000 }), { finalAmount: 5000 })
    expect(r.total).toBe(0)
    expect(r.belowMinSpend).toBe(true)
  })
  it('en o sobre el piso acredita normal', () => {
    expect(computeEarnedPoints(cfg({ minSpendToEarn: 10000 }), { finalAmount: 10000 }).total).toBe(20)
  })
  it('montos negativos se tratan como 0', () => {
    expect(computeEarnedPoints(cfg(), { finalAmount: -500 }).total).toBe(10)
  })
})
