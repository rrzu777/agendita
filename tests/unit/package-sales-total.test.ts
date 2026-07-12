import { describe, it, expect, vi, beforeEach } from 'vitest'

const requireRole = vi.hoisted(() => vi.fn())
const aggregate = vi.hoisted(() => vi.fn())
vi.mock('@/lib/auth/server', () => ({ requireBusinessRole: requireRole, ForbiddenError: class extends Error {} }))
vi.mock('@/lib/db', () => ({ prisma: { ledgerEntry: { aggregate } } }))

beforeEach(() => { requireRole.mockResolvedValue({ businessId: 'b1' }); aggregate.mockReset() })

const { getPackageSalesTotal } = await import('@/server/actions/packages')

describe('getPackageSalesTotal', () => {
  it('netea ventas menos reembolsos de paquete', async () => {
    aggregate
      .mockResolvedValueOnce({ _sum: { amount: 100000 } }) // package_sale
      .mockResolvedValueOnce({ _sum: { amount: 30000 } })  // refund_issued (paquete)
    expect(await getPackageSalesTotal()).toBe(70000)
  })

  it('trata sumas null como 0', async () => {
    aggregate.mockResolvedValue({ _sum: { amount: null } })
    expect(await getPackageSalesTotal()).toBe(0)
  })
})
