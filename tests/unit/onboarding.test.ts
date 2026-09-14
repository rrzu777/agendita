import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockPrisma = {
  service: { count: vi.fn() },
  availabilityRule: { count: vi.fn() },
  business: { findUnique: vi.fn(), updateMany: vi.fn() },
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
    mockPrisma.business.findUnique.mockResolvedValue({ onboardingCompletedAt: null })
    mockPrisma.business.updateMany.mockResolvedValue({ count: 1 })
  })

  it('does not complete onboarding when servicesCount is 0', async () => {
    mockPrisma.service.count.mockResolvedValue(0)

    const result = await completeOnboarding('biz-1')

    expect(result).toEqual({
      ok: false,
      error: expect.stringMatching(/al menos un servicio/),
    })
    expect(mockPrisma.business.updateMany).not.toHaveBeenCalled()
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
    expect(mockPrisma.business.updateMany).toHaveBeenCalledWith({
      where: { id: 'biz-1', onboardingCompletedAt: null },
      data: {
        onboardingCompletedAt: expect.any(Date),
        onboardingStep: null,
      },
    })
  })

  it('does not complete onboarding when the business has no active business-level availability', async () => {
    mockPrisma.service.count.mockResolvedValue(1)
    mockPrisma.availabilityRule.count.mockResolvedValue(0)

    const result = await completeOnboarding('biz-1')

    expect(result).toEqual({
      ok: false,
      error: expect.stringMatching(/al menos un día de atención/),
    })
    expect(mockPrisma.business.updateMany).not.toHaveBeenCalled()
  })

  it('applies only one completion transition while replayed delivery stays idempotent', async () => {
    mockPrisma.service.count.mockResolvedValue(1)
    mockPrisma.business.findUnique
      .mockResolvedValueOnce({ onboardingCompletedAt: null })
      .mockResolvedValueOnce({ onboardingCompletedAt: null })
      .mockResolvedValueOnce({ onboardingCompletedAt: new Date() })
    mockPrisma.business.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 })

    const first = await completeOnboarding('biz-1')
    const duplicate = await completeOnboarding('biz-1')

    expect(first).toMatchObject({ ok: true })
    expect(duplicate).toMatchObject({ ok: true })
    expect(mockPrisma.business.updateMany).toHaveBeenCalledTimes(2)
  })

  it('treats a retry after a committed completion as success without mutating twice', async () => {
    mockPrisma.business.findUnique.mockResolvedValue({ onboardingCompletedAt: new Date() })

    const retry = await completeOnboarding('biz-1')

    expect(retry).toMatchObject({ ok: true })
    expect(mockPrisma.service.count).not.toHaveBeenCalled()
    expect(mockPrisma.availabilityRule.count).not.toHaveBeenCalled()
    expect(mockPrisma.business.updateMany).not.toHaveBeenCalled()
  })
})

describe('saveOnboardingStep', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPrisma.business.updateMany.mockResolvedValue({ count: 1 })
  })

  it('saves the step for the session business', async () => {
    const result = await saveOnboardingStep('biz-1', 2)

    expect(result).toMatchObject({ ok: true })
    expect(mockPrisma.business.updateMany).toHaveBeenCalledWith({
      where: { id: 'biz-1', onboardingCompletedAt: null },
      data: { onboardingStep: 2 },
    })
  })

  it('rejects a business the session does not own', async () => {
    const result = await saveOnboardingStep('biz-other', 2)

    expect(result).toEqual({ ok: false, error: 'No autorizado' })
    expect(mockPrisma.business.updateMany).not.toHaveBeenCalled()
  })

  it.each([-1, 5, 1.5, Number.NaN])('rejects invalid persisted step %s', async (step) => {
    const result = await saveOnboardingStep('biz-1', step)

    expect(result).toEqual({ ok: false, error: expect.stringMatching(/paso de configuración/i) })
    expect(mockPrisma.business.updateMany).not.toHaveBeenCalled()
  })

  it('does not restore a step when a late tab save arrives after completion', async () => {
    mockPrisma.business.updateMany.mockResolvedValue({ count: 0 })

    const result = await saveOnboardingStep('biz-1', 4)

    expect(result).toMatchObject({ ok: true })
    expect(mockPrisma.business.updateMany).toHaveBeenCalledWith({
      where: { id: 'biz-1', onboardingCompletedAt: null },
      data: { onboardingStep: 4 },
    })
  })
})
