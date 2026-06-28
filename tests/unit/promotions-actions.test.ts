import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockPrisma = {
  promotion: { create: vi.fn(), update: vi.fn(), findFirst: vi.fn(), findMany: vi.fn() },
  promotionRedemption: { findMany: vi.fn() },
  service: { count: vi.fn() },
}
vi.mock('@/lib/db', () => ({ prisma: mockPrisma }))
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ success: true, remaining: 1, resetAt: 0 }),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/auth/server', () => ({
  requireBusiness: vi.fn().mockResolvedValue({ businessId: 'biz-1', business: { id: 'biz-1' }, role: 'owner', user: { id: 'u1' } }),
  requireBusinessRole: vi.fn().mockResolvedValue({ businessId: 'biz-1', business: { id: 'biz-1' }, role: 'owner', user: { id: 'u1' } }),
  ForbiddenError: class ForbiddenError extends Error { constructor(msg?: string) { super(msg || 'Forbidden') } },
}))

const { createPromotion, updatePromotion } = await import('@/server/actions/promotions')

describe('createPromotion', () => {
  beforeEach(() => vi.clearAllMocks())
  it('creates with a normalized code', async () => {
    mockPrisma.service.count.mockResolvedValue(0)
    mockPrisma.promotion.create.mockResolvedValue({ id: 'p1' })
    await createPromotion({ name: 'Verano', code: 'verano20', rewardType: 'percentage', rewardValue: 20, appliesToAll: true })
    expect(mockPrisma.promotion.create.mock.calls[0][0].data.code).toBe('VERANO20')
  })
  it('rejects services from another business', async () => {
    mockPrisma.service.count.mockResolvedValue(0) // pidió 1, existe 0
    await expect(createPromotion({ name: 'X', rewardType: 'percentage', rewardValue: 10, appliesToAll: false, serviceIds: ['s-foreign'] }))
      .rejects.toThrow('Servicio inválido')
  })
})

describe('updatePromotion', () => {
  beforeEach(() => vi.clearAllMocks())
  it('keeps the original code when the promo already has redemptions', async () => {
    mockPrisma.promotion.findFirst.mockResolvedValue({ id: 'p1', code: 'OLD', redemptionCount: 3 })
    mockPrisma.service.count.mockResolvedValue(0)
    mockPrisma.promotion.update.mockResolvedValue({ id: 'p1' })
    await updatePromotion('p1', { name: 'X', code: 'NEW', rewardType: 'percentage', rewardValue: 10, appliesToAll: true })
    expect(mockPrisma.promotion.update.mock.calls[0][0].data.code).toBe('OLD')
  })
})
