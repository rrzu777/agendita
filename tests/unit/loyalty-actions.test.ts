import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ForbiddenError } from '../helpers/auth-errors'

vi.mock('@/lib/auth/server', () => ({
  // `business` va con el mismo peso que `businessId`: el contrato real de
  // requireBusiness/requireBusinessRole devuelve la fila completa del negocio, y
  // las actions leen `business.category` para resolver el vocabulario del rubro.
  // Un mock que lo omite deja de decir la verdad y rompe con un error genérico.
  requireBusiness: vi.fn().mockResolvedValue({ businessId: 'b1', business: { id: 'b1', category: 'nails' } }),
  requireBusinessRole: vi.fn().mockResolvedValue({ businessId: 'b1', business: { id: 'b1', category: 'nails' }, user: { id: 'u1' } }),
  ForbiddenError,
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
    const result = await adjustCustomerPoints('c1', -50, 'x')
    expect(result).toEqual({ ok: false, error: 'El ajuste dejaría el saldo en negativo' })
  })
  it('rechaza clienta de otro negocio', async () => {
    ;(prisma.customer.findFirst as any).mockResolvedValue(null)
    const result = await adjustCustomerPoints('c1', 10, 'x')
    expect(result).toEqual({ ok: false, error: 'Clienta no encontrada' })
  })
  it('inserta el ajuste cuando el saldo queda >= 0', async () => {
    ;(prisma.customer.findFirst as any).mockResolvedValue({ id: 'c1', businessId: 'b1' })
    const create = vi.fn().mockResolvedValue({})
    ;(prisma.$transaction as any).mockImplementation(async (fn: any) => fn({
      $executeRaw: vi.fn().mockResolvedValue(1),
      loyaltyLedger: { aggregate: vi.fn().mockResolvedValue({ _sum: { points: 100 } }), create },
    }))
    const result = await adjustCustomerPoints('c1', -50, 'cortesía')
    expect(result).toEqual({ ok: true, data: undefined })
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ customerId: 'c1', points: -50, reason: 'adjustment', note: 'cortesía', createdByUserId: 'u1' }),
    }))
  })
})

describe('redeemPointsAsOwner', () => {
  it('rechaza clienta de otro negocio', async () => {
    ;(prisma.customer.findFirst as any).mockResolvedValue(null)
    const result = await redeemPointsAsOwner('c1', 'opt1', 'r1')
    expect(result).toEqual({ ok: false, error: 'Clienta no encontrada' })
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
    const result = await redeemPointsAsOwner('c1', 'opt1', 'r1')
    expect(result).toEqual({ ok: true, data: undefined })
    expect(create).toHaveBeenCalled()
  })
})
