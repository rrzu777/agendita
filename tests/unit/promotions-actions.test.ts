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
  requireBusiness: vi.fn().mockResolvedValue({ businessId: 'biz-1', business: { id: 'biz-1', timezone: 'America/Santiago' }, role: 'owner', user: { id: 'u1' } }),
  requireBusinessRole: vi.fn().mockResolvedValue({ businessId: 'biz-1', business: { id: 'biz-1', timezone: 'America/Santiago' }, role: 'owner', user: { id: 'u1' } }),
  ForbiddenError: class ForbiddenError extends Error { constructor(msg?: string) { super(msg || 'Forbidden') } },
}))

const { createPromotion, updatePromotion, setPromotionActive, getPromotionRedemptions } = await import('@/server/actions/promotions')

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
  it('surfaces a friendly message on a duplicate-code conflict (P2002)', async () => {
    mockPrisma.service.count.mockResolvedValue(0)
    mockPrisma.promotion.create.mockRejectedValue({ code: 'P2002' })
    await expect(createPromotion({ name: 'X', code: 'DUP', rewardType: 'percentage', rewardValue: 10, appliesToAll: true }))
      .rejects.toThrow('Ya existe una promoción con ese código')
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
  it('rejects when the promo is not found in the tenant', async () => {
    mockPrisma.promotion.findFirst.mockResolvedValue(null)
    await expect(updatePromotion('p-foreign', { name: 'X', rewardType: 'percentage', rewardValue: 10, appliesToAll: true }))
      .rejects.toThrow()
  })
})

describe('setPromotionActive', () => {
  beforeEach(() => vi.clearAllMocks())
  it('rejects when the promo is not found in the tenant', async () => {
    mockPrisma.promotion.findFirst.mockResolvedValue(null)
    await expect(setPromotionActive('p-foreign', false)).rejects.toThrow()
  })
})

describe('getPromotionRedemptions', () => {
  beforeEach(() => vi.clearAllMocks())
  it('scopes the query by businessId and promotionId', async () => {
    mockPrisma.promotionRedemption.findMany.mockResolvedValue([])
    await getPromotionRedemptions('p1')
    const where = mockPrisma.promotionRedemption.findMany.mock.calls[0][0].where
    expect(where).toMatchObject({ businessId: 'biz-1', promotionId: 'p1' })
  })
})
