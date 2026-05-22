import { describe, it, expect, afterEach, vi } from 'vitest'

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

afterEach(() => {
  process.env = { ...originalEnv }
  vi.resetModules()
})

describe('env validation', () => {
  describe('validateEnv', () => {
    it('returns empty errors and warnings when all required envs are set', async () => {
      setEnv({
        NODE_ENV: 'development',
        DATABASE_URL: 'postgresql://localhost/test',
        NEXT_PUBLIC_SUPABASE_URL: 'https://test.supabase.co',
        NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key',
        APP_DOMAIN: 'localhost:3000',
        NEXT_PUBLIC_APP_DOMAIN: 'localhost:3000',
        PAYMENT_PROVIDER: 'mock',
        SUPABASE_SERVICE_ROLE_KEY: 'service-key',
      })
      const { validateEnv } = await import('@/lib/env')
      const { errors, warnings } = validateEnv()
      expect(errors).toHaveLength(0)
      expect(warnings).toHaveLength(0)
    })

    it('warns about missing SUPABASE_SERVICE_ROLE_KEY', async () => {
      setEnv({
        NODE_ENV: 'development',
        DATABASE_URL: 'postgresql://localhost/test',
        NEXT_PUBLIC_SUPABASE_URL: 'https://test.supabase.co',
        NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key',
        APP_DOMAIN: 'localhost:3000',
        NEXT_PUBLIC_APP_DOMAIN: 'localhost:3000',
        PAYMENT_PROVIDER: 'mock',
        SUPABASE_SERVICE_ROLE_KEY: undefined,
      })
      const { validateEnv } = await import('@/lib/env')
      const { errors, warnings } = validateEnv()
      expect(errors).toHaveLength(0)
      const serviceRoleWarning = warnings.find((w) => w.key === 'SUPABASE_SERVICE_ROLE_KEY')
      expect(serviceRoleWarning).toBeDefined()
    })

    it('reports missing required envs as errors', async () => {
      setEnv({
        NODE_ENV: 'development',
        DATABASE_URL: undefined,
        NEXT_PUBLIC_SUPABASE_URL: undefined,
        NEXT_PUBLIC_SUPABASE_ANON_KEY: undefined,
        APP_DOMAIN: undefined,
        NEXT_PUBLIC_APP_DOMAIN: undefined,
        PAYMENT_PROVIDER: undefined,
      })
      const { validateEnv } = await import('@/lib/env')
      const { errors } = validateEnv()
      expect(errors.length).toBeGreaterThanOrEqual(5)
      const keys = errors.map((e) => e.key)
      expect(keys).toContain('DATABASE_URL')
      expect(keys).toContain('NEXT_PUBLIC_SUPABASE_URL')
      expect(keys).toContain('NEXT_PUBLIC_SUPABASE_ANON_KEY')
      expect(keys).toContain('APP_DOMAIN')
      expect(keys).toContain('NEXT_PUBLIC_APP_DOMAIN')
    })

    it('reports invalid PAYMENT_PROVIDER as error', async () => {
      setEnv({
        NODE_ENV: 'development',
        DATABASE_URL: 'postgresql://localhost/test',
        NEXT_PUBLIC_SUPABASE_URL: 'https://test.supabase.co',
        NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key',
        APP_DOMAIN: 'localhost:3000',
        NEXT_PUBLIC_APP_DOMAIN: 'localhost:3000',
        PAYMENT_PROVIDER: 'stripe',
      })
      const { validateEnv } = await import('@/lib/env')
      const { errors } = validateEnv()
      const paymentError = errors.find((e) => e.key === 'PAYMENT_PROVIDER')
      expect(paymentError).toBeDefined()
      expect(paymentError!.message).toContain('invalid')
    })

    it('requires PAYMENT_PROVIDER in production', async () => {
      setEnv({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://db/test',
        NEXT_PUBLIC_SUPABASE_URL: 'https://test.supabase.co',
        NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key',
        APP_DOMAIN: 'app.agendita.com',
        NEXT_PUBLIC_APP_DOMAIN: 'app.agendita.com',
        PAYMENT_PROVIDER: undefined,
      })
      const { validateEnv } = await import('@/lib/env')
      const { errors } = validateEnv()
      const paymentError = errors.find((e) => e.key === 'PAYMENT_PROVIDER')
      expect(paymentError).toBeDefined()
      expect(paymentError!.message).toContain('required in production')
    })

    it('does not require PAYMENT_PROVIDER in development', async () => {
      setEnv({
        NODE_ENV: 'development',
        DATABASE_URL: 'postgresql://localhost/test',
        NEXT_PUBLIC_SUPABASE_URL: 'https://test.supabase.co',
        NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key',
        APP_DOMAIN: 'localhost:3000',
        NEXT_PUBLIC_APP_DOMAIN: 'localhost:3000',
        PAYMENT_PROVIDER: undefined,
      })
      const { validateEnv } = await import('@/lib/env')
      const { errors } = validateEnv()
      const paymentError = errors.find((e) => e.key === 'PAYMENT_PROVIDER')
      expect(paymentError).toBeUndefined()
    })

    it('reports invalid ALLOW_MOCK_PAYMENTS_IN_PRODUCTION', async () => {
      setEnv({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://db/test',
        NEXT_PUBLIC_SUPABASE_URL: 'https://test.supabase.co',
        NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key',
        APP_DOMAIN: 'app.agendita.com',
        NEXT_PUBLIC_APP_DOMAIN: 'app.agendita.com',
        PAYMENT_PROVIDER: 'mock',
        ALLOW_MOCK_PAYMENTS_IN_PRODUCTION: 'invalid',
      })
      const { validateEnv } = await import('@/lib/env')
      const { errors } = validateEnv()
      const mockError = errors.find((e) => e.key === 'ALLOW_MOCK_PAYMENTS_IN_PRODUCTION')
      expect(mockError).toBeDefined()
      expect(mockError!.message).toContain('invalid')
    })
  })

  describe('getOptionalEnvBoolean', () => {
    it('returns true for "true"', async () => {
      setEnv({ TEST_BOOL: 'true' })
      const { getOptionalEnvBoolean } = await import('@/lib/env')
      expect(getOptionalEnvBoolean('TEST_BOOL')).toBe(true)
    })

    it('returns true for "TRUE" (case insensitive)', async () => {
      setEnv({ TEST_BOOL: 'TRUE' })
      const { getOptionalEnvBoolean } = await import('@/lib/env')
      expect(getOptionalEnvBoolean('TEST_BOOL')).toBe(true)
    })

    it('returns false for "false"', async () => {
      setEnv({ TEST_BOOL: 'false' })
      const { getOptionalEnvBoolean } = await import('@/lib/env')
      expect(getOptionalEnvBoolean('TEST_BOOL')).toBe(false)
    })

    it('returns undefined when not set', async () => {
      setEnv({ TEST_BOOL: undefined })
      const { getOptionalEnvBoolean } = await import('@/lib/env')
      expect(getOptionalEnvBoolean('TEST_BOOL')).toBeUndefined()
    })

    it('throws on invalid value', async () => {
      setEnv({ TEST_BOOL: 'invalid' })
      const { getOptionalEnvBoolean } = await import('@/lib/env')
      expect(() => getOptionalEnvBoolean('TEST_BOOL')).toThrow(/Invalid boolean/)
    })
  })

  describe('getRequiredEnv', () => {
    it('returns value when set', async () => {
      setEnv({ TEST_VAR: 'hello' })
      const { getRequiredEnv } = await import('@/lib/env')
      expect(getRequiredEnv('TEST_VAR')).toBe('hello')
    })

    it('throws when not set', async () => {
      setEnv({ TEST_VAR: undefined })
      const { getRequiredEnv } = await import('@/lib/env')
      expect(() => getRequiredEnv('TEST_VAR')).toThrow(/Missing required/)
    })
  })

  describe('isProduction', () => {
    it('returns true when NODE_ENV is production', async () => {
      setEnv({ NODE_ENV: 'production' })
      const { isProduction } = await import('@/lib/env')
      expect(isProduction()).toBe(true)
    })

    it('returns false when NODE_ENV is development', async () => {
      setEnv({ NODE_ENV: 'development' })
      const { isProduction } = await import('@/lib/env')
      expect(isProduction()).toBe(false)
    })
  })
})
