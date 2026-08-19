import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ForbiddenError } from '../helpers/auth-errors'
import type {
  PolicySettingsInput,
  ProfileSettingsInput,
  ReservationSettingsInput,
} from '@/lib/business/schema'

const mockPrisma = {
  business: {
    findFirst: vi.fn(),
    update: vi.fn(),
  },
}

const mockRequireBusinessRole = vi.fn()
const mockCheckRateLimit = vi.fn()
const mockRevalidatePath = vi.fn()
const mockRevalidateTag = vi.fn()
const mockRevalidateBusinessPublicPaths = vi.fn()

vi.mock('@/lib/db', () => ({
  prisma: mockPrisma,
}))

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: mockCheckRateLimit,
}))

vi.mock('@/lib/auth/server', () => ({
  requireBusinessRole: mockRequireBusinessRole,
  ForbiddenError,
}))

vi.mock('next/cache', () => ({
  revalidatePath: mockRevalidatePath,
  revalidateTag: mockRevalidateTag,
}))

vi.mock('@/server/actions/revalidate-business', () => ({
  revalidateBusinessPublicPaths: mockRevalidateBusinessPublicPaths,
}))

const {
  updatePolicySettings,
  updateProfileSettings,
  updateReservationSettings,
} = await import('@/server/actions/business-settings')
const businessSettingsActions = await import('@/server/actions/business-settings')

const profileInput: ProfileSettingsInput = {
  name: 'Mi Negocio', bio: '', profileImageUrl: '', logoUrl: '',
  whatsapp: '9 1234 5678', instagram: '@minegocio', addressText: '',
  city: 'Santiago', subdomain: 'mi-negocio',
}

const reservationInput: ReservationSettingsInput = {
  timezone: 'America/Santiago', slotStepMinutes: 'service', manualHoldHours: 24,
  requireBookingApproval: false, defaultMeetingUrl: '',
}

const policyInput: PolicySettingsInput = {
  selfServiceCutoffHours: 24, cancellationReminderEnabled: true,
  cancellationPolicy: '', bookingPolicy: '', depositPolicy: '',
}

describe('section-scoped business settings actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckRateLimit.mockResolvedValue({ success: true })
    mockRequireBusinessRole.mockResolvedValue({ businessId: 'biz-1' })
    mockPrisma.business.findFirst.mockResolvedValue(null)
    mockPrisma.business.update.mockResolvedValue({
      name: 'Mi Negocio', bio: null, profileImageUrl: null, logoUrl: null,
      whatsapp: '+56912345678', instagram: 'minegocio', addressText: null,
      city: 'Santiago', subdomain: 'mi-negocio',
      timezone: 'America/Santiago', slotStepMinutes: null, manualHoldHours: 24,
      requireBookingApproval: false, defaultMeetingUrl: null,
      selfServiceCutoffHours: 24, cancellationReminderEnabled: true,
      cancellationPolicy: null, bookingPolicy: null, depositPolicy: null,
    })
  })

  it('exports only section-scoped settings actions', () => {
    expect(businessSettingsActions).not.toHaveProperty('updateBusinessSettings')
  })

  describe('auth & session', () => {
    it('rejects non-owner/non-admin users', async () => {
      mockRequireBusinessRole.mockRejectedValue(
        new ForbiddenError('No tienes permisos')
      )

      const result = await updateProfileSettings(profileInput)

      expect(result).toEqual({ ok: false, error: 'No tienes permisos' })
      expect(mockPrisma.business.update).not.toHaveBeenCalled()
    })

    it('uses businessId from session, never from input', async () => {
      mockRequireBusinessRole.mockResolvedValue({ businessId: 'session-biz-123' })

      await updateProfileSettings({ ...profileInput, businessId: 'attacker-biz' } as never)

      expect(mockPrisma.business.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'session-biz-123' },
        })
      )
    })
  })

  describe('subdomain validation', () => {
    it.each([
      ['www'],
      ['app'],
      ['admin'],
      ['dashboard'],
      ['api'],
      ['login'],
      ['register'],
      ['support'],
    ])('rejects reserved subdomain: %s', async (subdomain) => {
      const result = await updateProfileSettings({ ...profileInput, subdomain })

      expect(result).toEqual({ ok: false, error: 'Este subdominio está reservado' })
      expect(mockPrisma.business.update).not.toHaveBeenCalled()
    })

    it('rejects duplicate subdomain from another business', async () => {
      mockPrisma.business.findFirst.mockResolvedValue({
        id: 'other-biz',
        subdomain: 'miestudio',
      })

      const result = await updateProfileSettings(profileInput)

      expect(result).toEqual({ ok: false, error: 'Este subdominio ya está en uso' })
      expect(mockPrisma.business.update).not.toHaveBeenCalled()
    })

    it('allows keeping current subdomain (excluded from uniqueness check)', async () => {
      mockPrisma.business.findFirst.mockResolvedValue(null)

      const result = await updateProfileSettings(profileInput)

      expect(result).toMatchObject({ ok: true })
      expect(mockPrisma.business.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            subdomain: 'mi-negocio',
            NOT: { id: 'biz-1' },
          }),
        })
      )
      expect(mockPrisma.business.update).toHaveBeenCalled()
    })
  })

  describe('data normalization', () => {
    it('persists cancellation reminders disabled explicitly', async () => {
      await updatePolicySettings({ ...policyInput, cancellationReminderEnabled: false })

      expect(mockPrisma.business.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            cancellationReminderEnabled: false,
          }),
        })
      )
    })

    it('normalizes whatsapp and instagram before saving', async () => {
      const result = await updateProfileSettings(profileInput)

      expect(result).toMatchObject({ ok: true })
      expect(mockPrisma.business.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            whatsapp: '+56912345678',
            instagram: 'minegocio',
          }),
        })
      )
    })

    it('trims name and city before saving', async () => {
      await updateProfileSettings({ ...profileInput, name: '  Mi Estudio  ', city: '  Santiago  ' })

      expect(mockPrisma.business.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            name: 'Mi Estudio',
            city: 'Santiago',
          }),
        })
      )
    })

    it('converts empty strings to null for nullable fields', async () => {
      await updateProfileSettings({
        ...profileInput,
        bio: '',
        profileImageUrl: '',
        logoUrl: '',
        whatsapp: '',
        instagram: '',
        addressText: '',
      })

      expect(mockPrisma.business.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            bio: null,
            profileImageUrl: null,
            logoUrl: null,
            whatsapp: null,
            instagram: null,
            addressText: null,
          }),
        })
      )

      await updatePolicySettings(policyInput)
      expect(mockPrisma.business.update).toHaveBeenLastCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            cancellationPolicy: null,
            bookingPolicy: null,
            depositPolicy: null,
          }),
        })
      )
    })
  })

  describe('rate limiting', () => {
    it('rejects when rate limit is exceeded', async () => {
      mockCheckRateLimit.mockResolvedValue({ success: false })

      const result = await updateProfileSettings(profileInput)

      expect(result).toEqual({
        ok: false,
        error: expect.stringMatching(/Demasiadas solicitudes/),
      })
      expect(mockPrisma.business.update).not.toHaveBeenCalled()
    })
  })
  it('profile update never writes reservation or policy columns', async () => {
    const result = await updateProfileSettings(profileInput)
    const call = mockPrisma.business.update.mock.calls[0][0]

    expect(call.where).toEqual({ id: 'biz-1' })
    expect(Object.keys(call.data).sort()).toEqual([
      'addressText', 'bio', 'city', 'instagram', 'logoUrl', 'name',
      'profileImageUrl', 'subdomain', 'whatsapp',
    ])
    expect(result).toMatchObject({ ok: true, data: { whatsapp: '+56912345678', bio: '' } })
  })

  it('reservation update writes only reservation fields', async () => {
    await updateReservationSettings(reservationInput)

    expect(mockPrisma.business.update.mock.calls[0][0].data).toEqual({
      timezone: 'America/Santiago', slotStepMinutes: null, manualHoldHours: 24,
      requireBookingApproval: false, defaultMeetingUrl: null,
    })
  })

  it('policy update writes only policy fields', async () => {
    await updatePolicySettings(policyInput)

    expect(mockPrisma.business.update.mock.calls[0][0].data).toEqual({
      selfServiceCutoffHours: 24, cancellationReminderEnabled: true,
      cancellationPolicy: null, bookingPolicy: null, depositPolicy: null,
    })
  })

  it('profile update rejects reserved and duplicate subdomains', async () => {
    const reserved = await updateProfileSettings({ ...profileInput, subdomain: 'www' })
    expect(reserved).toEqual({ ok: false, error: 'Este subdominio está reservado' })

    mockPrisma.business.findFirst.mockResolvedValue({ id: 'other-biz', subdomain: profileInput.subdomain })
    const duplicate = await updateProfileSettings(profileInput)
    expect(duplicate).toEqual({ ok: false, error: 'Este subdominio ya está en uso' })
    expect(mockPrisma.business.findFirst).toHaveBeenCalledWith({
      where: { subdomain: profileInput.subdomain, NOT: { id: 'biz-1' } },
      select: { id: true },
    })
    expect(mockPrisma.business.update).not.toHaveBeenCalled()
  })

  it('profile update translates a concurrent subdomain P2002 into the duplicate error', async () => {
    mockPrisma.business.update.mockRejectedValue({ code: 'P2002' })
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    try {
      await expect(updateProfileSettings(profileInput)).resolves.toEqual({
        ok: false,
        error: 'Este subdominio ya está en uso',
      })
    } finally {
      consoleError.mockRestore()
    }
  })

  it('profile update does not translate non-P2002 persistence errors', async () => {
    mockPrisma.business.update.mockRejectedValue(new Error('database unavailable'))
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    try {
      await expect(updateProfileSettings(profileInput)).resolves.toEqual({
        ok: false,
        error: 'Ocurrió un error inesperado. Intenta nuevamente.',
      })
    } finally {
      consoleError.mockRestore()
    }
  })

  it('profile update rejects an unauthorized session', async () => {
    mockRequireBusinessRole.mockRejectedValue(new ForbiddenError('No tienes permisos'))

    await expect(updateProfileSettings(profileInput)).resolves.toEqual({ ok: false, error: 'No tienes permisos' })
    expect(mockPrisma.business.update).not.toHaveBeenCalled()
  })

  it('reservation update rejects an unauthorized session', async () => {
    mockRequireBusinessRole.mockRejectedValue(new ForbiddenError('No tienes permisos'))

    await expect(updateReservationSettings(reservationInput)).resolves.toEqual({ ok: false, error: 'No tienes permisos' })
    expect(mockPrisma.business.update).not.toHaveBeenCalled()
  })

  it('policy update rejects an unauthorized session', async () => {
    mockRequireBusinessRole.mockRejectedValue(new ForbiddenError('No tienes permisos'))

    await expect(updatePolicySettings(policyInput)).resolves.toEqual({ ok: false, error: 'No tienes permisos' })
    expect(mockPrisma.business.update).not.toHaveBeenCalled()
  })

  it('each section shares the settings rate-limit bucket', async () => {
    mockCheckRateLimit.mockResolvedValue({ success: false })

    await expect(updateProfileSettings(profileInput)).resolves.toMatchObject({ ok: false })
    await expect(updateReservationSettings(reservationInput)).resolves.toMatchObject({ ok: false })
    await expect(updatePolicySettings(policyInput)).resolves.toMatchObject({ ok: false })

    expect(mockCheckRateLimit).toHaveBeenNthCalledWith(1, 'update-business-settings', 20, 60000)
    expect(mockCheckRateLimit).toHaveBeenNthCalledWith(2, 'update-business-settings', 20, 60000)
    expect(mockCheckRateLimit).toHaveBeenNthCalledWith(3, 'update-business-settings', 20, 60000)
    expect(mockPrisma.business.update).not.toHaveBeenCalled()
  })

  it('profile update ignores a malicious businessId', async () => {
    mockRequireBusinessRole.mockResolvedValue({ businessId: 'session-biz-123' })
    await updateProfileSettings({ ...profileInput, businessId: 'attacker-biz' } as never)

    expect(mockPrisma.business.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'session-biz-123' } }))
  })

  it('reservation update ignores a malicious businessId', async () => {
    mockRequireBusinessRole.mockResolvedValue({ businessId: 'session-biz-123' })
    await updateReservationSettings({ ...reservationInput, businessId: 'attacker-biz' } as never)

    expect(mockPrisma.business.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'session-biz-123' } }))
  })

  it('policy update ignores a malicious businessId', async () => {
    mockRequireBusinessRole.mockResolvedValue({ businessId: 'session-biz-123' })
    await updatePolicySettings({ ...policyInput, businessId: 'attacker-biz' } as never)

    expect(mockPrisma.business.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'session-biz-123' } }))
  })
})
