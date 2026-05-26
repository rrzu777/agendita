import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockPrisma = {
  service: { count: vi.fn() },
  availabilityRule: { count: vi.fn() },
  business: { update: vi.fn() },
}

vi.mock('@/lib/db', () => ({ prisma: mockPrisma }))
vi.mock('@/lib/auth/server', () => ({
  requireBusiness: vi.fn().mockResolvedValue({ businessId: 'biz-1' }),
}))

const { completeOnboarding } = await import('@/server/actions/onboarding')

describe('completeOnboarding', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPrisma.availabilityRule.count.mockResolvedValue(1)
    mockPrisma.business.update.mockResolvedValue({ id: 'biz-1' })
  })

  it('does not complete onboarding when servicesCount is 0', async () => {
    mockPrisma.service.count.mockResolvedValue(0)

    await expect(completeOnboarding('biz-1')).rejects.toThrow(/al menos un servicio/)
    expect(mockPrisma.business.update).not.toHaveBeenCalled()
  })
})
