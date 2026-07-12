import { describe, it, expect, vi, beforeEach } from 'vitest'

const requireRole = vi.hoisted(() => vi.fn())
const activateMock = vi.hoisted(() => vi.fn())
const txClient = vi.hoisted(() => ({
  packagePurchase: { create: vi.fn().mockResolvedValue({ id: 'p1', businessId: 'b1', customerId: 'c1', pricePaid: 30000, quantity: 3, bonusQuantity: 0, expiresAt: null, createdByUserId: 'u1' }) },
}))

vi.mock('@/lib/auth/server', () => ({
  requireBusinessRole: requireRole,
  ForbiddenError: class extends Error {},
}))
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: vi.fn().mockResolvedValue({ success: true }) }))
vi.mock('@/lib/packages/activate', () => ({ activatePackagePurchaseInTx: activateMock, getOrCreatePackageMarkerPromotion: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/db', () => ({
  prisma: {
    packageProduct: { findFirst: vi.fn().mockResolvedValue({ id: 'prod1', price: 30000, quantity: 3, bonusQuantity: 0, appliesToAll: true, expiryDays: null, services: [] }) },
    customer: { findFirst: vi.fn().mockResolvedValue({ id: 'c1' }) },
    $transaction: vi.fn().mockImplementation(async (fn: any) => fn(txClient)),
  },
}))

beforeEach(() => {
  requireRole.mockResolvedValue({ businessId: 'b1', user: { id: 'u1' } })
  activateMock.mockReset().mockResolvedValue(undefined)
})

const { sellPackage } = await import('@/server/actions/packages')

describe('sellPackage', () => {
  it('crea la compra y delega la activación (grants + ledger) al activador', async () => {
    await sellPackage({ packageProductId: 'prod1', customerId: 'c1', paymentMethod: 'efectivo', requestId: 'req-1' })
    expect(txClient.packagePurchase.create).toHaveBeenCalled()
    expect(activateMock).toHaveBeenCalledWith(
      txClient,
      expect.objectContaining({ id: 'p1' }),
      expect.objectContaining({ requestId: 'req-1', createdByUserId: 'u1' }),
    )
  })
})
