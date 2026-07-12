import { describe, it, expect, vi, beforeEach } from 'vitest'
vi.mock('@/lib/auth/server', () => ({ requireBusiness: vi.fn().mockResolvedValue({ businessId: 'b1' }) }))
const aggregate = vi.fn()
const count = vi.fn().mockResolvedValue(0)
vi.mock('@/lib/db', () => ({
  prisma: {
    ledgerEntry: { aggregate: (...a: unknown[]) => aggregate(...a), findMany: vi.fn() },
    payment: { aggregate: (...a: unknown[]) => aggregate(...a) },
    booking: { aggregate: (...a: unknown[]) => aggregate(...a), count: () => count() },
  },
}))
import { getFinancialSummary } from './ledger'

describe('getFinancialSummary — ingresos por paquete', () => {
  beforeEach(() => aggregate.mockReset())
  it('devuelve packageIncomeToday/Month', async () => {
    aggregate.mockResolvedValue({ _sum: { amount: 1000, remainingBalance: 0 } })
    const summary = await getFinancialSummary()
    expect(summary).toHaveProperty('packageIncomeToday')
    expect(summary).toHaveProperty('packageIncomeMonth')
  })
})
