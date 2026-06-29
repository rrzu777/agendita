import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/auth/server', () => ({
  requireBusiness: vi.fn().mockResolvedValue({ businessId: 'b1' }),
  requireBusinessRole: vi.fn().mockResolvedValue({ businessId: 'b1', user: { id: 'u1' } }),
  ForbiddenError: class extends Error {},
}))
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: vi.fn().mockResolvedValue({ success: true }) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/db', () => ({ prisma: {
  customer: { findFirst: vi.fn() },
  $transaction: vi.fn(),
  promotion: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn() },
  promotionGrant: { findUnique: vi.fn(), findMany: vi.fn() },
  loyaltyConfig: { findUnique: vi.fn() },
  service: { count: vi.fn() },
} }))

import { adjustCustomerPoints, redeemPointsAsOwner } from '@/server/actions/loyalty'
import { prisma } from '@/lib/db'

beforeEach(() => vi.clearAllMocks())

describe('adjustCustomerPoints', () => {
  it('rechaza si dejaría el saldo negativo', async () => {
    ;(prisma.customer.findFirst as any).mockResolvedValue({ id: 'c1', businessId: 'b1' })
    ;(prisma.$transaction as any).mockImplementation(async (fn: any) => fn({
      $executeRaw: vi.fn().mockResolvedValue(1),
      loyaltyLedger: {
        aggregate: vi.fn().mockResolvedValue({ _sum: { points: 10 } }),
        create: vi.fn(),
      },
    }))
    await expect(adjustCustomerPoints('c1', -50, 'x')).rejects.toThrow()
  })
  it('rechaza clienta de otro negocio', async () => {
    ;(prisma.customer.findFirst as any).mockResolvedValue(null)
    await expect(adjustCustomerPoints('c1', 10, 'x')).rejects.toThrow()
  })
  it('inserta el ajuste cuando el saldo queda >= 0', async () => {
    ;(prisma.customer.findFirst as any).mockResolvedValue({ id: 'c1', businessId: 'b1' })
    const create = vi.fn().mockResolvedValue({})
    ;(prisma.$transaction as any).mockImplementation(async (fn: any) => fn({
      $executeRaw: vi.fn().mockResolvedValue(1),
      loyaltyLedger: { aggregate: vi.fn().mockResolvedValue({ _sum: { points: 100 } }), create },
    }))
    await adjustCustomerPoints('c1', -50, 'cortesía')
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ customerId: 'c1', points: -50, reason: 'adjustment', note: 'cortesía', createdByUserId: 'u1' }),
    }))
  })
})

describe('redeemPointsAsOwner', () => {
  it('rechaza clienta de otro negocio', async () => {
    ;(prisma.customer.findFirst as any).mockResolvedValue(null)
    await expect(redeemPointsAsOwner('c1', 'opt1', 'r1')).rejects.toThrow()
  })
  it('canjea: corre redeemForGrant dentro de la transacción', async () => {
    ;(prisma.customer.findFirst as any).mockResolvedValue({ id: 'c1' })
    ;(prisma.promotion.findFirst as any).mockResolvedValue({ id: 'opt1', businessId: 'b1',
      triggerType: 'granted', isActive: true, pointsCost: 50, grantExpiryDays: null,
      maxRedemptions: null, maxPerCustomer: null })
    ;(prisma.loyaltyConfig.findUnique as any).mockResolvedValue({ isActive: true,
      grantExpiryDays: 90, refundPointsOnExpiry: true, forfeitGrantOnNoShow: false })
    const create = vi.fn().mockResolvedValue({ id: 'g1' })
    ;(prisma.$transaction as any).mockImplementation(async (fn: any) => fn({
      $executeRaw: vi.fn().mockResolvedValue(1),
      promotionGrant: { findUnique: vi.fn().mockResolvedValue(null), findMany: vi.fn().mockResolvedValue([]),
        findFirst: vi.fn().mockResolvedValue(null), count: vi.fn().mockResolvedValue(0),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }), create },
      promotion: { findFirst: vi.fn().mockResolvedValue(null), update: vi.fn(), updateMany: vi.fn() },
      loyaltyLedger: { aggregate: vi.fn().mockResolvedValue({ _sum: { points: 100 } }), create: vi.fn() },
    }))
    await redeemPointsAsOwner('c1', 'opt1', 'r1')
    expect(create).toHaveBeenCalled()
  })
})
