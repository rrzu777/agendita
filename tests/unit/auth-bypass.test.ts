import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const originalEnv = { ...process.env }

function setEnv(vars: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(vars)) {
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
}

const headersMap = new Map<string, string>()
const mockPrisma = {
  user: { findUnique: vi.fn() },
  businessUser: { findFirst: vi.fn() },
}

vi.mock('next/headers', () => ({
  headers: vi.fn(() => ({
    get: (name: string) => headersMap.get(name) ?? null,
  })),
}))

vi.mock('@/lib/db', () => ({
  prisma: mockPrisma,
}))

vi.mock('@/lib/auth/middleware', () => ({
  createClient: vi.fn(() => ({
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }),
      getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
    },
  })),
}))

async function getModule() {
  return await import('@/lib/auth/user')
}

describe('E2E auth bypass', () => {
  beforeEach(() => {
    vi.resetModules()
    headersMap.clear()
    mockPrisma.user.findUnique.mockReset()
    mockPrisma.businessUser.findFirst.mockReset()
  })

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  const dbUser = {
    id: 'u-e2e',
    email: 'e2e@test.agendita.com',
    name: 'E2E User',
    createdAt: new Date(),
    businesses: [{ business: { id: 'b1', isActive: true, slug: 'test' }, role: 'staff' }],
  }

  function enableLocally() {
    setEnv({
      NODE_ENV: 'development',
      ENABLE_E2E_AUTH_BYPASS: 'true',
      E2E_AUTH_BYPASS_SECRET: undefined,
    })
  }

  function setEmailHeader(email: string) {
    headersMap.set('x-e2e-test-user-email', email)
  }

  function setSecretHeader(secret: string) {
    headersMap.set('x-e2e-auth-secret', secret)
  }

  describe('getCurrentUser', () => {
    it('returns null when ENABLE_E2E_AUTH_BYPASS is not set', async () => {
      setEnv({ NODE_ENV: 'development', ENABLE_E2E_AUTH_BYPASS: undefined })
      setEmailHeader('e2e@test.agendita.com')
      const { getCurrentUser } = await getModule()
      const result = await getCurrentUser()
      expect(result).toBeNull()
    })

    it('returns synthetic user when bypass is enabled and headers match', async () => {
      enableLocally()
      setEmailHeader('e2e@test.agendita.com')
      setSecretHeader('test-secret')
      mockPrisma.user.findUnique.mockResolvedValue(dbUser)
      const { getCurrentUser } = await getModule()
      const result = await getCurrentUser()
      expect(result).toBeDefined()
      expect(result!.id).toBe('u-e2e')
      expect(result!.email).toBe('e2e@test.agendita.com')
    })

    it('returns null when email header is missing', async () => {
      enableLocally()
      mockPrisma.user.findUnique.mockResolvedValue(dbUser)
      const { getCurrentUser } = await getModule()
      const result = await getCurrentUser()
      expect(result).toBeNull()
    })

    it('returns null when user not found in DB', async () => {
      enableLocally()
      setEmailHeader('nonexistent@test.com')
      mockPrisma.user.findUnique.mockResolvedValue(null)
      const { getCurrentUser } = await getModule()
      const result = await getCurrentUser()
      expect(result).toBeNull()
    })
  })

  describe('getCurrentUserWithBusiness', () => {
    it('returns user + business when bypass is enabled', async () => {
      enableLocally()
      setEmailHeader('e2e@test.agendita.com')
      setSecretHeader('test-secret')
      mockPrisma.user.findUnique.mockResolvedValue(dbUser)
      const { getCurrentUserWithBusiness } = await getModule()
      const result = await getCurrentUserWithBusiness()
      expect(result).toBeDefined()
      expect(result!.user.id).toBe('u-e2e')
      expect(result!.business).toBeDefined()
      expect(result!.role).toBe('staff')
    })
  })

  describe('production blocking', () => {
    it('bypass is disabled in production when APP_ENV is not e2e', async () => {
      setEnv({
        NODE_ENV: 'production',
        ENABLE_E2E_AUTH_BYPASS: 'true',
        E2E_AUTH_BYPASS_SECRET: 'test-secret',
        APP_ENV: undefined,
      })
      setEmailHeader('e2e@test.agendita.com')
      setSecretHeader('test-secret')
      mockPrisma.user.findUnique.mockResolvedValue(dbUser)
      const { getCurrentUser } = await getModule()
      const result = await getCurrentUser()
      expect(result).toBeNull()
    })

    it('bypass is enabled in production when APP_ENV=e2e with valid secret', async () => {
      setEnv({
        NODE_ENV: 'production',
        APP_ENV: 'e2e',
        ENABLE_E2E_AUTH_BYPASS: 'true',
        E2E_AUTH_BYPASS_SECRET: 'e2e-secret-2026',
      })
      setEmailHeader('e2e@test.agendita.com')
      setSecretHeader('e2e-secret-2026')
      mockPrisma.user.findUnique.mockResolvedValue(dbUser)
      const { getCurrentUser } = await getModule()
      const result = await getCurrentUser()
      expect(result).toBeDefined()
      expect(result!.id).toBe('u-e2e')
    })
  })

  describe('secret validation', () => {
    it('rejects when secret header does not match E2E_AUTH_BYPASS_SECRET in dev', async () => {
      setEnv({
        NODE_ENV: 'development',
        ENABLE_E2E_AUTH_BYPASS: 'true',
        E2E_AUTH_BYPASS_SECRET: 'correct-secret',
      })
      setEmailHeader('e2e@test.agendita.com')
      setSecretHeader('wrong-secret')
      mockPrisma.user.findUnique.mockResolvedValue(dbUser)
      const { getCurrentUser } = await getModule()
      const result = await getCurrentUser()
      expect(result).toBeNull()
    })

    it('accepts when secret header matches E2E_AUTH_BYPASS_SECRET in dev', async () => {
      setEnv({
        NODE_ENV: 'development',
        ENABLE_E2E_AUTH_BYPASS: 'true',
        E2E_AUTH_BYPASS_SECRET: 'correct-secret',
      })
      setEmailHeader('e2e@test.agendita.com')
      setSecretHeader('correct-secret')
      mockPrisma.user.findUnique.mockResolvedValue(dbUser)
      const { getCurrentUser } = await getModule()
      const result = await getCurrentUser()
      expect(result).toBeDefined()
      expect(result!.id).toBe('u-e2e')
    })

    it('accepts any secret when E2E_AUTH_BYPASS_SECRET is not set in dev', async () => {
      enableLocally()
      setEmailHeader('e2e@test.agendita.com')
      setSecretHeader('any-random-secret')
      mockPrisma.user.findUnique.mockResolvedValue(dbUser)
      const { getCurrentUser } = await getModule()
      const result = await getCurrentUser()
      expect(result).toBeDefined()
      expect(result!.id).toBe('u-e2e')
    })

    it('rejects in production when E2E_AUTH_BYPASS_SECRET is not set', async () => {
      setEnv({
        NODE_ENV: 'production',
        APP_ENV: 'e2e',
        ENABLE_E2E_AUTH_BYPASS: 'true',
        E2E_AUTH_BYPASS_SECRET: undefined,
      })
      setEmailHeader('e2e@test.agendita.com')
      setSecretHeader('any')
      mockPrisma.user.findUnique.mockResolvedValue(dbUser)
      const { getCurrentUser } = await getModule()
      const result = await getCurrentUser()
      expect(result).toBeNull()
    })
  })
})
