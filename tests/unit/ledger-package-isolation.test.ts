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
  it('cada agregado income/refund está explícitamente scopeado por packagePurchaseId (booking null vs paquete not-null)', async () => {
    await getFinancialSummary()
    const incomeCalls = ledgerAgg.mock.calls.filter((c: any) => c[0].where.direction === 'income')
    const refundCalls = ledgerAgg.mock.calls.filter((c: any) => c[0].where.type === 'refund_issued')
    expect(incomeCalls.length).toBeGreaterThan(0)
    expect(refundCalls.length).toBeGreaterThan(0)
    // Invariante: ningún agregado mezcla filas de reserva y de paquete. Los KPI de
    // reserva filtran `packagePurchaseId: null`; las líneas de paquete (B4b-2)
    // filtran `{ not: null }`. Nunca debe quedar sin scopear.
    for (const c of [...incomeCalls, ...refundCalls]) {
      const pkg = c[0].where.packagePurchaseId
      const isBookingScoped = pkg === null
      const isPackageScoped = pkg != null && pkg.not === null
      expect(isBookingScoped || isPackageScoped).toBe(true)
    }
  })
})
