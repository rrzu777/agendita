import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/auth/server', () => ({
  requireBusiness: vi.fn().mockResolvedValue({ businessId: 'b1' }),
  requireBusinessRole: vi.fn(), ForbiddenError: class extends Error {},
}))
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: vi.fn().mockResolvedValue({ success: true }) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/db', () => ({ prisma: {
  promotionGrant: { findFirst: vi.fn() },
  promotion: { findFirst: vi.fn() },
  service: { findFirst: vi.fn() },
  customer: { findFirst: vi.fn() },
  promotionRedemption: { count: vi.fn() },
} }))

import { previewPromotion } from '@/server/actions/promotions'
import { prisma } from '@/lib/db'
beforeEach(() => vi.clearAllMocks())

describe('previewPromotion — grant', () => {
  it('un grant activo devuelve el descuento', async () => {
    ;(prisma.promotionGrant.findFirst as any).mockResolvedValue({ id: 'g1', expiresAt: null,
      promotion: { appliesToAll: true, services: [], minSpend: null, rewardType: 'percentage', rewardValue: 50, maxDiscount: null } })
    ;(prisma.service.findFirst as any).mockResolvedValue({ id: 's1', price: 1000 })
    const res = await previewPromotion({ businessId: 'b1', code: 'ABC123', serviceId: 's1' })
    expect(res.ok).toBe(true)
    expect(res.ok && res.data).toMatchObject({ ok: true, discount: 500, finalAmount: 500 })
  })
  it('un grant vencido devuelve inválido genérico', async () => {
    ;(prisma.promotionGrant.findFirst as any).mockResolvedValue({ id: 'g1', expiresAt: new Date('2000-01-01'),
      promotion: { appliesToAll: true, services: [], minSpend: null, rewardType: 'percentage', rewardValue: 50, maxDiscount: null } })
    ;(prisma.service.findFirst as any).mockResolvedValue({ id: 's1', price: 1000 })
    const res = await previewPromotion({ businessId: 'b1', code: 'ABC123', serviceId: 's1' })
    expect(res.ok).toBe(true)
    expect(res.ok && res.data.ok).toBe(false)
  })
})
