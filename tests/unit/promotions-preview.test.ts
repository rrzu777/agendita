import { describe, it, expect, vi, beforeEach } from 'vitest'
const mockPrisma: any = {
  promotion: { findFirst: vi.fn() }, service: { findFirst: vi.fn() },
  customer: { findFirst: vi.fn() }, promotionRedemption: { count: vi.fn() },
}
vi.mock('@/lib/db', () => ({ prisma: mockPrisma }))
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: vi.fn().mockResolvedValue({ success: true }) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/auth/server', () => ({ requireBusiness: vi.fn(), requireBusinessRole: vi.fn(), ForbiddenError: class extends Error {} }))
const { previewPromotion } = await import('@/server/actions/promotions')

describe('previewPromotion', () => {
  beforeEach(() => vi.clearAllMocks())
  it('returns generic invalid for unknown code (no info leak)', async () => {
    mockPrisma.promotion.findFirst.mockResolvedValue(null)
    mockPrisma.service.findFirst.mockResolvedValue({ id: 'svc1', price: 20000 })
    const r = await previewPromotion({ businessId: 'biz-1', code: 'NOPE', serviceId: 'svc1' })
    expect(r.ok).toBe(false)
  })
  it('returns discount for a valid code', async () => {
    mockPrisma.promotion.findFirst.mockResolvedValue({ id: 'p1', isActive: true, validFrom: null, validUntil: null, maxRedemptions: null, maxPerCustomer: null, minSpend: null, appliesToAll: true, rewardType: 'percentage', rewardValue: 20, maxDiscount: null, redemptionCount: 0, services: [] })
    mockPrisma.service.findFirst.mockResolvedValue({ id: 'svc1', price: 20000 })
    const r = await previewPromotion({ businessId: 'biz-1', code: 'VERANO20', serviceId: 'svc1' })
    expect(r).toMatchObject({ ok: true, discount: 4000, finalAmount: 16000 })
  })
})
