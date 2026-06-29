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
} }))

import { adjustCustomerPoints } from '@/server/actions/loyalty'
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
