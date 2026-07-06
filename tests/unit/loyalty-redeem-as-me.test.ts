import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockRequireUser, mockFindFirstCustomer, mockFindFirstPromotion,
  mockFindUniqueConfig, mockTx, mockRedeem, mockRevalidate,
} = vi.hoisted(() => ({
  mockRequireUser: vi.fn(),
  mockFindFirstCustomer: vi.fn(),
  mockFindFirstPromotion: vi.fn(),
  mockFindUniqueConfig: vi.fn(),
  mockTx: vi.fn(),
  mockRedeem: vi.fn(),
  mockRevalidate: vi.fn(),
}))

vi.mock('@/lib/auth/server', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/lib/auth/server')>()
  return { ...mod, requireUser: mockRequireUser }
})
vi.mock('@/lib/db', () => ({
  prisma: {
    customer: { findFirst: mockFindFirstCustomer },
    promotion: { findFirst: mockFindFirstPromotion, findMany: vi.fn() },
    loyaltyConfig: { findUnique: mockFindUniqueConfig },
    $transaction: mockTx,
    promotionGrant: { findUnique: vi.fn() },
  },
}))
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: vi.fn().mockResolvedValue({ success: true }) }))
vi.mock('next/cache', () => ({ revalidatePath: mockRevalidate }))
vi.mock('@/lib/loyalty/redeem', () => ({ redeemForGrant: mockRedeem }))

describe('redeemPointsAsMe', () => {
  beforeEach(() => vi.clearAllMocks())

  it('canjea para un Customer propio y revalida /mi y la tarjeta pública', async () => {
    mockRequireUser.mockResolvedValue({ id: 'u1' })
    mockFindFirstCustomer.mockResolvedValue({
      id: 'c1', businessId: 'b1', loyaltyToken: 'tok-1',
      business: { slug: 'mimosnails', loyaltyConfig: { isActive: true, grantExpiryDays: null, refundPointsOnExpiry: true, forfeitGrantOnNoShow: false } },
    })
    mockFindFirstPromotion.mockResolvedValue({ id: 'p1', businessId: 'b1', triggerType: 'granted', isActive: true, pointsCost: 100, grantExpiryDays: null, maxRedemptions: null, maxPerCustomer: null })
    mockFindUniqueConfig.mockResolvedValue({ isActive: true, grantExpiryDays: null, refundPointsOnExpiry: true, forfeitGrantOnNoShow: false })
    mockTx.mockImplementation(async (fn: (tx: unknown) => Promise<void>) => fn({}))

    const { redeemPointsAsMe } = await import('@/server/actions/loyalty')
    await redeemPointsAsMe('c1', 'p1', 'req-1')
    expect(mockRedeem).toHaveBeenCalled()
    expect(mockFindFirstCustomer).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'c1', userId: 'u1' }),
    }))
    expect(mockRevalidate).toHaveBeenCalledWith('/mi/mimosnails')
    expect(mockRevalidate).toHaveBeenCalledWith('/tarjeta/tok-1')
  })

  it('rechaza un Customer ajeno, sin canjear', async () => {
    mockRequireUser.mockResolvedValue({ id: 'u1' })
    mockFindFirstCustomer.mockResolvedValue(null)
    const { redeemPointsAsMe } = await import('@/server/actions/loyalty')
    await expect(redeemPointsAsMe('c-ajeno', 'p1', 'req-1')).rejects.toThrow()
    expect(mockRedeem).not.toHaveBeenCalled()
  })

  it('no revalida la tarjeta si el customer no tiene loyaltyToken', async () => {
    mockRequireUser.mockResolvedValue({ id: 'u1' })
    mockFindFirstCustomer.mockResolvedValue({
      id: 'c1', businessId: 'b1', loyaltyToken: null,
      business: { slug: 'mimosnails', loyaltyConfig: { isActive: true, grantExpiryDays: null, refundPointsOnExpiry: true, forfeitGrantOnNoShow: false } },
    })
    mockFindFirstPromotion.mockResolvedValue({ id: 'p1', businessId: 'b1', triggerType: 'granted', isActive: true, pointsCost: 100, grantExpiryDays: null, maxRedemptions: null, maxPerCustomer: null })
    mockFindUniqueConfig.mockResolvedValue({ isActive: true })
    mockTx.mockImplementation(async (fn: (tx: unknown) => Promise<void>) => fn({}))
    const { redeemPointsAsMe } = await import('@/server/actions/loyalty')
    await redeemPointsAsMe('c1', 'p1', 'req-1')
    expect(mockRevalidate).toHaveBeenCalledWith('/mi/mimosnails')
    expect(mockRevalidate).not.toHaveBeenCalledWith(expect.stringContaining('/tarjeta/'))
  })
})
