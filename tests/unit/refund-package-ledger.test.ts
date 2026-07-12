import { describe, it, expect, vi, beforeEach } from 'vitest'

const requireRole = vi.hoisted(() => vi.fn())
const tx = vi.hoisted(() => ({
  promotionGrant: { updateMany: vi.fn().mockResolvedValue({}) },
  packagePurchase: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
  ledgerEntry: { create: vi.fn().mockResolvedValue({}) },
}))

vi.mock('@/lib/auth/server', () => ({ requireBusinessRole: requireRole, ForbiddenError: class extends Error {} }))
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: vi.fn().mockResolvedValue({ success: true }) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/server/actions/revalidate-business', () => ({ revalidateBusinessPublicPaths: vi.fn() }))
vi.mock('@/lib/packages/activate', () => ({ activatePackagePurchaseInTx: vi.fn(), getOrCreatePackageMarkerPromotion: vi.fn() }))
vi.mock('@/lib/payments/factory', () => ({ getMercadoPagoProviderForBusiness: vi.fn() }))
vi.mock('@/lib/db', () => ({
  prisma: {
    packagePurchase: { findFirst: vi.fn().mockResolvedValue({ id: 'p1', businessId: 'b1', customerId: 'c1', status: 'active', pricePaid: 30000, quantity: 3, bonusQuantity: 0, _count: { grants: 3 } }) },
    payment: { findFirst: vi.fn().mockResolvedValue(null) },
    $transaction: vi.fn().mockImplementation(async (fn: any) => fn(tx)),
  },
}))

beforeEach(() => { requireRole.mockResolvedValue({ businessId: 'b1' }); tx.ledgerEntry.create.mockClear() })

const { refundPackagePurchase } = await import('@/server/actions/packages')

describe('refundPackagePurchase', () => {
  it('escribe un asiento refund_issued prorrateado con packagePurchaseId', async () => {
    await refundPackagePurchase('p1')
    // 3 sesiones sin usar de 3 → reembolso completo = 30000
    expect(tx.ledgerEntry.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        businessId: 'b1', packagePurchaseId: 'p1', customerId: 'c1',
        type: 'refund_issued', direction: 'expense', amount: 30000,
      }),
    }))
  })
})
