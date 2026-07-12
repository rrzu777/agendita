import { describe, it, expect, vi, beforeEach } from 'vitest'

const requireRole = vi.hoisted(() => vi.fn())
const ledgerAgg = vi.hoisted(() => vi.fn())
vi.mock('@/lib/auth/server', () => ({ requireBusiness: requireRole, requireBusinessRole: requireRole, ForbiddenError: class extends Error {} }))
vi.mock('@/lib/db', () => ({
  prisma: {
    ledgerEntry: { aggregate: ledgerAgg },
    payment: { aggregate: vi.fn().mockResolvedValue({ _sum: { amount: 0 } }) },
    booking: { aggregate: vi.fn().mockResolvedValue({ _sum: { remainingBalance: 0 } }), count: vi.fn().mockResolvedValue(0) },
  },
}))

beforeEach(() => { requireRole.mockResolvedValue({ businessId: 'b1' }); ledgerAgg.mockReset().mockResolvedValue({ _sum: { amount: 0 } }) })

const { getFinancialSummary } = await import('@/server/actions/ledger')

describe('getFinancialSummary aísla las filas de paquete', () => {
  it('income y refund excluyen filas con packagePurchaseId', async () => {
    await getFinancialSummary()
    const incomeCalls = ledgerAgg.mock.calls.filter((c: any) => c[0].where.direction === 'income')
    const refundCalls = ledgerAgg.mock.calls.filter((c: any) => c[0].where.type === 'refund_issued')
    expect(incomeCalls.length).toBeGreaterThan(0)
    expect(refundCalls.length).toBeGreaterThan(0)
    for (const c of [...incomeCalls, ...refundCalls]) {
      expect(c[0].where.packagePurchaseId).toBe(null)
    }
  })
})
