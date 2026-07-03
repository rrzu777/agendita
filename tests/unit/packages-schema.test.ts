import { describe, it, expect } from 'vitest'
import { packageProductSchema, computePackageRefund, perGrantRequestId } from '@/lib/packages/schema'

describe('packageProductSchema', () => {
  it('acepta un producto válido', () => {
    const r = packageProductSchema.safeParse({
      name: 'Pack 5 manicuras', quantity: 5, bonusQuantity: 1, price: 50000,
      expiryDays: 90, appliesToAll: true, serviceIds: [], isActive: true,
    })
    expect(r.success).toBe(true)
  })
  it('rechaza quantity < 1', () => {
    expect(packageProductSchema.safeParse({ name: 'x', quantity: 0, price: 1, appliesToAll: true, serviceIds: [] }).success).toBe(false)
  })
  it('exige servicios si no appliesToAll', () => {
    expect(packageProductSchema.safeParse({ name: 'x', quantity: 1, price: 1, appliesToAll: false, serviceIds: [] }).success).toBe(false)
  })
})

describe('computePackageRefund', () => {
  it('prorratea por total de sesiones (quantity+bonus), tope pricePaid', () => {
    expect(computePackageRefund({ pricePaid: 60000, quantity: 5, bonusQuantity: 1, unusedSessions: 3 })).toBe(30000)
  })
  it('nunca supera pricePaid', () => {
    expect(computePackageRefund({ pricePaid: 60000, quantity: 5, bonusQuantity: 1, unusedSessions: 6 })).toBe(60000)
  })
  it('0 usos no usados → 0', () => {
    expect(computePackageRefund({ pricePaid: 60000, quantity: 5, bonusQuantity: 1, unusedSessions: 0 })).toBe(0)
  })
})

describe('perGrantRequestId', () => {
  it('deriva ids distintos y deterministas', () => {
    expect(perGrantRequestId('sale-abc', 0)).toBe('sale-abc#0')
    expect(perGrantRequestId('sale-abc', 2)).toBe('sale-abc#2')
    expect(perGrantRequestId('sale-abc', 0)).not.toBe(perGrantRequestId('sale-abc', 1))
  })
})
