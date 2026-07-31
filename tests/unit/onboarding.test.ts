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

  /**
   * El requisito es que el NEGOCIO tenga al menos un día de atención. Sin
   * `professionalId: null`, alguien del equipo con horario propio alcanzaría para dar
   * por cumplido un horario que el salón no tiene — y el mismo contador se muestra
   * como número en el panel, donde un salón de 4 personas diría 28 días de atención.
   */
  it('el horario que cuenta es el del salón, no el del equipo', async () => {
    mockPrisma.service.count.mockResolvedValue(1)

    await completeOnboarding('biz-1')

    expect(mockPrisma.availabilityRule.count).toHaveBeenCalledWith({
      where: { businessId: 'biz-1', professionalId: null, isActive: true },
    })
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

  it('rejects a business the session does not own', async () => {
    const result = await saveOnboardingStep('biz-other', 2)

    expect(result).toEqual({ ok: false, error: 'No autorizado' })
    expect(mockPrisma.business.update).not.toHaveBeenCalled()
  })
})
