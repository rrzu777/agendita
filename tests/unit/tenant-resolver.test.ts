import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockPrisma = {
  business: {
    findUnique: vi.fn(),
  },
}

vi.mock('@/lib/db/prisma', () => ({
  prisma: mockPrisma,
}))

const headersMap = new Map<string, string>()

vi.mock('next/headers', () => ({
  headers: () => ({
    get: (name: string) => headersMap.get(name) ?? null,
  }),
}))

const {
  getCurrentBusinessFromSubdomain,
  getTenantFromRequest,
  resolveTenant,
  isDashboardPath,
} = await import('@/lib/tenant/resolver')

function setHeaders(entries: Record<string, string>) {
  headersMap.clear()
  for (const [key, value] of Object.entries(entries)) {
    headersMap.set(key, value)
  }
}

describe('tenant resolver', () => {
  beforeEach(() => {
    mockPrisma.business.findUnique.mockReset()
    headersMap.clear()
    delete process.env.APP_DOMAIN
    delete process.env.NEXT_PUBLIC_APP_DOMAIN
  })

  describe('getCurrentBusinessFromSubdomain', () => {
    const activeBusiness = {
      id: 'biz-1',
      slug: 'mimosnails',
      subdomain: 'mimosnails',
      isActive: true,
    }

    const inactiveBusiness = {
      id: 'biz-2',
      slug: 'closed',
      subdomain: 'closed',
      isActive: false,
    }

    it('returns null for null subdomain', async () => {
      const result = await getCurrentBusinessFromSubdomain(null)
      expect(result).toBeNull()
    })

    it('returns null for undefined subdomain', async () => {
      const result = await getCurrentBusinessFromSubdomain(undefined)
      expect(result).toBeNull()
    })

    it('returns null for empty string subdomain', async () => {
      const result = await getCurrentBusinessFromSubdomain('')
      expect(result).toBeNull()
    })

    it('returns tenant for valid active subdomain', async () => {
      mockPrisma.business.findUnique.mockResolvedValue(activeBusiness)
      const result = await getCurrentBusinessFromSubdomain('mimosnails')
      expect(result).toEqual({
        businessId: 'biz-1',
        slug: 'mimosnails',
        subdomain: 'mimosnails',
        isCustomDomain: false,
      })
      expect(mockPrisma.business.findUnique).toHaveBeenCalledWith({
        where: { subdomain: 'mimosnails' },
        select: { id: true, slug: true, subdomain: true, isActive: true },
      })
    })

    it('returns null for inactive business', async () => {
      mockPrisma.business.findUnique.mockResolvedValue(inactiveBusiness)
      const result = await getCurrentBusinessFromSubdomain('closed')
      expect(result).toBeNull()
    })

    it('returns null when business not found', async () => {
      mockPrisma.business.findUnique.mockResolvedValue(null)
      const result = await getCurrentBusinessFromSubdomain('nonexistent')
      expect(result).toBeNull()
    })

    it('lowercases subdomain before query', async () => {
      mockPrisma.business.findUnique.mockResolvedValue(activeBusiness)
      await getCurrentBusinessFromSubdomain('MimoSnails')
      expect(mockPrisma.business.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { subdomain: 'mimosnails' },
        }),
      )
    })
  })

  describe('resolveTenant', () => {
    const activeBusiness = {
      id: 'biz-1',
      slug: 'mimosnails',
      subdomain: 'mimosnails',
      isActive: true,
    }

    const customDomainBusiness = {
      id: 'biz-3',
      slug: 'custom',
      subdomain: 'custom',
      isActive: true,
    }

    it('returns null when hostname is app domain', async () => {
      process.env.APP_DOMAIN = 'agendita.com'
      const result = await resolveTenant('agendita.com')
      expect(result).toBeNull()
    })

    it('returns null when hostname is www.app domain', async () => {
      process.env.APP_DOMAIN = 'agendita.com'
      const result = await resolveTenant('www.agendita.com')
      expect(result).toBeNull()
    })

    it('returns null for localhost', async () => {
      const result = await resolveTenant('localhost')
      expect(result).toBeNull()
    })

    it('returns null for 127.0.0.1', async () => {
      const result = await resolveTenant('127.0.0.1')
      expect(result).toBeNull()
    })

    it('resolves subdomain of app domain', async () => {
      process.env.APP_DOMAIN = 'agendita.com'
      mockPrisma.business.findUnique.mockResolvedValue(activeBusiness)
      const result = await resolveTenant('mimosnails.agendita.com')
      expect(result).toEqual({
        businessId: 'biz-1',
        slug: 'mimosnails',
        subdomain: 'mimosnails',
        isCustomDomain: false,
      })
    })

    it('resolves subdomain on localhost', async () => {
      process.env.APP_DOMAIN = 'localhost:3000'
      mockPrisma.business.findUnique.mockResolvedValue(activeBusiness)
      await resolveTenant('mimosnails.localhost:3000')
      expect(mockPrisma.business.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { subdomain: 'mimosnails' } }),
      )
    })

    it('resolves custom domain', async () => {
      process.env.APP_DOMAIN = 'agendita.com'
      mockPrisma.business.findUnique.mockResolvedValue(customDomainBusiness)
      const result = await resolveTenant('mipropionegocio.cl')
      expect(mockPrisma.business.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { customDomain: 'mipropionegocio.cl' } }),
      )
      expect(result).toEqual({
        businessId: 'biz-3',
        slug: 'custom',
        subdomain: 'custom',
        isCustomDomain: true,
      })
    })

    it('returns null when custom domain business is inactive', async () => {
      process.env.APP_DOMAIN = 'agendita.com'
      mockPrisma.business.findUnique.mockResolvedValue({
        id: 'biz-4',
        slug: 'inactive-custom',
        subdomain: 'inactive',
        isActive: false,
      })
      const result = await resolveTenant('inactivo.cl')
      expect(result).toBeNull()
    })

    it('returns null when hostname domain does not match', async () => {
      process.env.APP_DOMAIN = 'agendita.com'
      mockPrisma.business.findUnique.mockResolvedValue(null)
      const result = await resolveTenant('randomsite.com')
      expect(result).toBeNull()
    })
  })

  describe('getTenantFromRequest', () => {
    const activeBusiness = {
      id: 'biz-1',
      slug: 'mimosnails',
      subdomain: 'mimosnails',
      isActive: true,
    }

    it('uses x-business-subdomain header when present', async () => {
      setHeaders({
        'x-business-subdomain': 'mimosnails',
        'host': 'mimosnails.agendita.com',
      })

      mockPrisma.business.findUnique.mockResolvedValue(activeBusiness)
      const result = await getTenantFromRequest()
      expect(result).toEqual({
        businessId: 'biz-1',
        slug: 'mimosnails',
        subdomain: 'mimosnails',
        isCustomDomain: false,
      })
    })

    it('returns null for www in x-business-subdomain header', async () => {
      setHeaders({ 'x-business-subdomain': 'www' })

      const result = await getTenantFromRequest()
      expect(result).toBeNull()
    })

    it('falls back to host header when x-business-subdomain not set', async () => {
      process.env.APP_DOMAIN = 'agendita.com'
      setHeaders({ 'host': 'mimosnails.agendita.com' })

      mockPrisma.business.findUnique.mockResolvedValue(activeBusiness)
      const result = await getTenantFromRequest()
      expect(result).toEqual({
        businessId: 'biz-1',
        slug: 'mimosnails',
        subdomain: 'mimosnails',
        isCustomDomain: false,
      })
    })

    it('accepts custom Headers parameter', async () => {
      mockPrisma.business.findUnique.mockResolvedValue(activeBusiness)
      const customHeaders = new Headers()
      customHeaders.set('x-business-subdomain', 'mimosnails')

      const result = await getTenantFromRequest(customHeaders)
      expect(result).toEqual({
        businessId: 'biz-1',
        slug: 'mimosnails',
        subdomain: 'mimosnails',
        isCustomDomain: false,
      })
    })

    it('returns null when no tenant info is available', async () => {
      process.env.APP_DOMAIN = 'agendita.com'
      setHeaders({ 'host': 'agendita.com' })

      mockPrisma.business.findUnique.mockResolvedValue(null)
      const result = await getTenantFromRequest()
      expect(result).toBeNull()
    })

    it('uses x-forwarded-host when host is not available', async () => {
      process.env.APP_DOMAIN = 'agendita.com'
      setHeaders({ 'x-forwarded-host': 'mimosnails.agendita.com' })

      mockPrisma.business.findUnique.mockResolvedValue(activeBusiness)
      const result = await getTenantFromRequest()
      expect(result).toEqual({
        businessId: 'biz-1',
        slug: 'mimosnails',
        subdomain: 'mimosnails',
        isCustomDomain: false,
      })
    })
  })

  describe('isDashboardPath', () => {
    it('returns true for /dashboard', () => {
      expect(isDashboardPath('/dashboard')).toBe(true)
    })

    it('returns true for /dashboard/subpath', () => {
      expect(isDashboardPath('/dashboard/settings')).toBe(true)
      expect(isDashboardPath('/dashboard/bookings/123')).toBe(true)
    })

    it('returns false for non-dashboard paths', () => {
      expect(isDashboardPath('/')).toBe(false)
      expect(isDashboardPath('/book')).toBe(false)
      expect(isDashboardPath('/api/health')).toBe(false)
      expect(isDashboardPath('/mimosnails')).toBe(false)
    })
  })
})
