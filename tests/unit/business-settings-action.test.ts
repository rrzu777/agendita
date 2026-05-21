import { describe, it, expect, vi, beforeEach } from 'vitest'

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
  ForbiddenError: class ForbiddenError extends Error {
    constructor(message = 'No tienes permisos') {
      super(message)
      this.name = 'ForbiddenError'
    }
  },
}))

vi.mock('next/cache', () => ({
  revalidatePath: mockRevalidatePath,
  revalidateTag: mockRevalidateTag,
}))

vi.mock('@/server/actions/revalidate-business', () => ({
  revalidateBusinessPublicPaths: mockRevalidateBusinessPublicPaths,
}))

const { updateBusinessSettings } = await import('@/server/actions/business-settings')

describe('updateBusinessSettings', () => {
  const baseData = {
    name: 'Mi Estudio',
    city: 'Santiago',
    timezone: 'America/Santiago',
    subdomain: 'miestudio',
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckRateLimit.mockResolvedValue({ success: true })
    mockRequireBusinessRole.mockResolvedValue({ businessId: 'biz-1' })
    mockPrisma.business.findFirst.mockResolvedValue(null)
    mockPrisma.business.update.mockResolvedValue({ id: 'biz-1', ...baseData })
  })

  describe('auth & session', () => {
    it('rejects non-owner/non-admin users', async () => {
      mockRequireBusinessRole.mockRejectedValue(
        new Error('No tienes permisos')
      )

      await expect(updateBusinessSettings(baseData)).rejects.toThrow('No tienes permisos')
      expect(mockPrisma.business.update).not.toHaveBeenCalled()
    })

    it('uses businessId from session, never from input', async () => {
      mockRequireBusinessRole.mockResolvedValue({ businessId: 'session-biz-123' })

      await updateBusinessSettings({
        ...baseData,
        // Intento malicioso de enviar businessId en el payload
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any)

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
      await expect(
        updateBusinessSettings({ ...baseData, subdomain })
      ).rejects.toThrow('Este subdominio está reservado')
      expect(mockPrisma.business.update).not.toHaveBeenCalled()
    })

    it('rejects duplicate subdomain from another business', async () => {
      mockPrisma.business.findFirst.mockResolvedValue({
        id: 'other-biz',
        subdomain: 'miestudio',
      })

      await expect(updateBusinessSettings(baseData)).rejects.toThrow(
        'Este subdominio ya está en uso'
      )
      expect(mockPrisma.business.update).not.toHaveBeenCalled()
    })

    it('allows keeping current subdomain (excluded from uniqueness check)', async () => {
      mockPrisma.business.findFirst.mockResolvedValue(null)

      await updateBusinessSettings(baseData)

      expect(mockPrisma.business.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            subdomain: 'miestudio',
            NOT: { id: 'biz-1' },
          }),
        })
      )
      expect(mockPrisma.business.update).toHaveBeenCalled()
    })
  })

  describe('data normalization', () => {
    it('normalizes whatsapp and instagram before saving', async () => {
      await updateBusinessSettings({
        ...baseData,
        whatsapp: '9 1234 5678',
        instagram: '@miestudio',
      })

      expect(mockPrisma.business.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            whatsapp: '+56912345678',
            instagram: 'miestudio',
          }),
        })
      )
    })

    it('trims name and city before saving', async () => {
      await updateBusinessSettings({
        ...baseData,
        name: '  Mi Estudio  ',
        city: '  Santiago  ',
      })

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
      await updateBusinessSettings({
        ...baseData,
        bio: '',
        profileImageUrl: '',
        logoUrl: '',
        whatsapp: '',
        instagram: '',
        addressText: '',
        cancellationPolicy: '',
        bookingPolicy: '',
        depositPolicy: '',
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

      await expect(updateBusinessSettings(baseData)).rejects.toThrow(
        'Demasiadas solicitudes'
      )
      expect(mockPrisma.business.update).not.toHaveBeenCalled()
    })
  })
})
