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
      getClaims: vi.fn().mockResolvedValue({ data: null, error: null }),
      getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }),
      getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
    },
  })),
}))

async function getModule() {
  return await import('@/lib/auth/user')
}

async function getE2EModule() {
  return await import('@/lib/auth/e2e-bypass')
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
    email: 'e2e@test.agendita.cl',
    name: 'E2E User',
    createdAt: new Date(),
    businesses: [{ business: { id: 'b1', isActive: true, slug: 'test' }, role: 'staff' }],
  }

  function enableDev() {
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

  describe('isE2EBypassEnabled', () => {
    it('returns false when ENABLE_E2E_AUTH_BYPASS is not set', async () => {
      setEnv({ NODE_ENV: 'development' })
      const { isE2EBypassEnabled } = await getE2EModule()
      expect(isE2EBypassEnabled()).toBe(false)
    })

    it('returns false when ENABLE_E2E_AUTH_BYPASS is set but not "true"', async () => {
      setEnv({ NODE_ENV: 'development', ENABLE_E2E_AUTH_BYPASS: 'false' })
      const { isE2EBypassEnabled } = await getE2EModule()
      expect(isE2EBypassEnabled()).toBe(false)
    })

    it('returns true in development with ENABLE_E2E_AUTH_BYPASS=true', async () => {
      enableDev()
      const { isE2EBypassEnabled } = await getE2EModule()
      expect(isE2EBypassEnabled()).toBe(true)
    })

    it('returns false in production without APP_ENV=e2e', async () => {
      setEnv({ NODE_ENV: 'production', ENABLE_E2E_AUTH_BYPASS: 'true', E2E_AUTH_BYPASS_SECRET: 'secret' })
      const { isE2EBypassEnabled } = await getE2EModule()
      expect(isE2EBypassEnabled()).toBe(false)
    })

    it('returns true in production with APP_ENV=e2e and secret', async () => {
      setEnv({ NODE_ENV: 'production', ENABLE_E2E_AUTH_BYPASS: 'true', APP_ENV: 'e2e', E2E_AUTH_BYPASS_SECRET: 'secret' })
      const { isE2EBypassEnabled } = await getE2EModule()
      expect(isE2EBypassEnabled()).toBe(true)
    })

    it('returns false in production with APP_ENV=e2e but no secret', async () => {
      setEnv({ NODE_ENV: 'production', ENABLE_E2E_AUTH_BYPASS: 'true', APP_ENV: 'e2e', E2E_AUTH_BYPASS_SECRET: undefined })
      const { isE2EBypassEnabled } = await getE2EModule()
      expect(isE2EBypassEnabled()).toBe(false)
    })
  })

  describe('validateE2EHeaders', () => {
    it('returns null when bypass disabled', async () => {
      setEnv({ NODE_ENV: 'development' })
      setEmailHeader('e2e@test.agendita.cl')
      setSecretHeader('secret')
      const { validateE2EHeaders } = await getE2EModule()
      expect(await validateE2EHeaders()).toBeNull()
    })

    it('returns email when headers valid in dev (no secret required)', async () => {
      enableDev()
      setEmailHeader('e2e@test.agendita.cl')
      setSecretHeader('any-secret')
      const { validateE2EHeaders } = await getE2EModule()
      expect(await validateE2EHeaders()).toBe('e2e@test.agendita.cl')
    })

    it('returns null when email header missing', async () => {
      enableDev()
      setSecretHeader('any-secret')
      const { validateE2EHeaders } = await getE2EModule()
      expect(await validateE2EHeaders()).toBeNull()
    })

    it('returns null when secret header missing', async () => {
      enableDev()
      setEmailHeader('e2e@test.agendita.cl')
      const { validateE2EHeaders } = await getE2EModule()
      expect(await validateE2EHeaders()).toBeNull()
    })

    it('validates secret matches E2E_AUTH_BYPASS_SECRET in dev when set', async () => {
      setEnv({ NODE_ENV: 'development', ENABLE_E2E_AUTH_BYPASS: 'true', E2E_AUTH_BYPASS_SECRET: 'correct' })
      setEmailHeader('e2e@test.agendita.cl')
      setSecretHeader('correct')
      const { validateE2EHeaders } = await getE2EModule()
      expect(await validateE2EHeaders()).toBe('e2e@test.agendita.cl')
    })

    it('rejects wrong secret in dev when E2E_AUTH_BYPASS_SECRET is set', async () => {
      setEnv({ NODE_ENV: 'development', ENABLE_E2E_AUTH_BYPASS: 'true', E2E_AUTH_BYPASS_SECRET: 'correct' })
      setEmailHeader('e2e@test.agendita.cl')
      setSecretHeader('wrong')
      const { validateE2EHeaders } = await getE2EModule()
      expect(await validateE2EHeaders()).toBeNull()
    })
  })

  describe('getCurrentUser', () => {
    it('returns synthetic user when bypass active', async () => {
      enableDev()
      setEmailHeader('e2e@test.agendita.cl')
      setSecretHeader('test-secret')
      mockPrisma.user.findUnique.mockResolvedValue(dbUser)
      const { getCurrentUser } = await getModule()
      const result = await getCurrentUser()
      expect(result).toBeDefined()
      expect(result!.id).toBe('u-e2e')
      expect(result!.email).toBe('e2e@test.agendita.cl')
    })

    it('returns null when bypass off and no Supabase session', async () => {
      setEnv({ NODE_ENV: 'development' })
      setEmailHeader('e2e@test.agendita.cl')
      const { getCurrentUser } = await getModule()
      const result = await getCurrentUser()
      expect(result).toBeNull()
    })
  })

  describe('getCurrentUserWithBusiness', () => {
    it('returns user + business when bypass active', async () => {
      enableDev()
      setEmailHeader('e2e@test.agendita.cl')
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
})
