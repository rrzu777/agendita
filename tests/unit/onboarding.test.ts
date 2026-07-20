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

const { completeOnboarding, saveOnboardingStep } = await import('@/server/actions/onboarding')

describe('completeOnboarding', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPrisma.availabilityRule.count.mockResolvedValue(1)
    mockPrisma.business.update.mockResolvedValue({ id: 'biz-1' })
  })

  it('does not complete onboarding when servicesCount is 0', async () => {
    mockPrisma.service.count.mockResolvedValue(0)

    const result = await completeOnboarding('biz-1')

    expect(result).toEqual({
      ok: false,
      error: expect.stringMatching(/al menos un servicio/),
    })
    expect(mockPrisma.business.update).not.toHaveBeenCalled()
  })

  it('completes onboarding when services and availability are configured', async () => {
    mockPrisma.service.count.mockResolvedValue(1)

    const result = await completeOnboarding('biz-1')

    expect(result).toMatchObject({ ok: true })
    expect(mockPrisma.business.update).toHaveBeenCalledWith({
      where: { id: 'biz-1' },
      data: {
        onboardingCompletedAt: expect.any(Date),
        onboardingStep: null,
      },
    })
  })
})

describe('saveOnboardingStep', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPrisma.business.update.mockResolvedValue({ id: 'biz-1' })
  })

  it('saves the step for the session business', async () => {
    const result = await saveOnboardingStep('biz-1', 2)

    expect(result).toMatchObject({ ok: true })
    expect(mockPrisma.business.update).toHaveBeenCalledWith({
      where: { id: 'biz-1' },
      data: { onboardingStep: 2 },
    })
  })
})
