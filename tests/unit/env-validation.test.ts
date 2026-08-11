import { describe, it, expect, afterEach, vi } from 'vitest'
import {
  OTHER_VAPID_PUBLIC_KEY,
  TEST_VAPID_PRIVATE_KEY,
  TEST_VAPID_PUBLIC_KEY,
} from '../helpers/push-fixtures'

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
    it('allows Web Push to stay fully disabled when all VAPID variables are absent', async () => {
      setEnv({
        NEXT_PUBLIC_VAPID_PUBLIC_KEY: undefined,
        VAPID_PRIVATE_KEY: undefined,
        VAPID_SUBJECT: undefined,
      })
      const { validateEnv } = await import('@/lib/env')

      const { errors } = validateEnv()

      expect(errors.some((error) => error.key.includes('VAPID'))).toBe(false)
    })

    it.each([
      { NEXT_PUBLIC_VAPID_PUBLIC_KEY: 'public', VAPID_PRIVATE_KEY: undefined, VAPID_SUBJECT: undefined },
      { NEXT_PUBLIC_VAPID_PUBLIC_KEY: 'public', VAPID_PRIVATE_KEY: 'private', VAPID_SUBJECT: undefined },
      { NEXT_PUBLIC_VAPID_PUBLIC_KEY: undefined, VAPID_PRIVATE_KEY: 'private', VAPID_SUBJECT: 'mailto:push@agendita.cl' },
    ])('rejects partial VAPID configuration', async (vapid) => {
      setEnv(vapid)
      const { validateEnv } = await import('@/lib/env')

      const { errors } = validateEnv()

      expect(errors).toEqual(expect.arrayContaining([
        expect.objectContaining({ key: 'NEXT_PUBLIC_VAPID_PUBLIC_KEY' }),
      ]))
    })

    it('requires ENCRYPTION_KEY when the complete VAPID trio enables push', async () => {
      setEnv({
        NEXT_PUBLIC_VAPID_PUBLIC_KEY: TEST_VAPID_PUBLIC_KEY,
        VAPID_PRIVATE_KEY: TEST_VAPID_PRIVATE_KEY,
        VAPID_SUBJECT: 'mailto:push@agendita.cl',
        ENCRYPTION_KEY: undefined,
      })
      const { validateEnv } = await import('@/lib/env')

      const { errors } = validateEnv()

      expect(errors).toEqual(expect.arrayContaining([
        expect.objectContaining({ key: 'ENCRYPTION_KEY' }),
      ]))
    })

    it.each([
      'http://agendita.cl',
      'push@agendita.cl',
      'mailto:',
    ])('rejects an unsafe VAPID_SUBJECT: %s', async (subject) => {
      setEnv({
        NEXT_PUBLIC_VAPID_PUBLIC_KEY: TEST_VAPID_PUBLIC_KEY,
        VAPID_PRIVATE_KEY: TEST_VAPID_PRIVATE_KEY,
        VAPID_SUBJECT: subject,
        ENCRYPTION_KEY: 'encryption-key',
      })
      const { validateEnv } = await import('@/lib/env')

      const { errors } = validateEnv()

      expect(errors).toEqual(expect.arrayContaining([
        expect.objectContaining({ key: 'VAPID_SUBJECT' }),
      ]))
    })

    it.each(['mailto:push@agendita.cl', 'https://www.agendita.cl/push-contact'])(
      'accepts a complete encrypted VAPID configuration with subject %s',
      async (subject) => {
        setEnv({
          NEXT_PUBLIC_VAPID_PUBLIC_KEY: TEST_VAPID_PUBLIC_KEY,
          VAPID_PRIVATE_KEY: TEST_VAPID_PRIVATE_KEY,
          VAPID_SUBJECT: subject,
          ENCRYPTION_KEY: 'encryption-key',
        })
        const { validateEnv } = await import('@/lib/env')

        const { errors } = validateEnv()

        expect(errors.filter((error) => [
          'NEXT_PUBLIC_VAPID_PUBLIC_KEY',
          'VAPID_PRIVATE_KEY',
          'VAPID_SUBJECT',
          'ENCRYPTION_KEY',
        ].includes(error.key))).toEqual([])
      },
    )

    it('rejects individually valid VAPID keys that do not form a pair', async () => {
      setEnv({
        NEXT_PUBLIC_VAPID_PUBLIC_KEY: OTHER_VAPID_PUBLIC_KEY,
        VAPID_PRIVATE_KEY: TEST_VAPID_PRIVATE_KEY,
        VAPID_SUBJECT: 'mailto:push@agendita.cl',
        ENCRYPTION_KEY: 'encryption-key',
      })
      const { validateEnv } = await import('@/lib/env')

      const { errors } = validateEnv()

      expect(errors).toEqual(expect.arrayContaining([
        expect.objectContaining({
          key: 'VAPID_PRIVATE_KEY',
          message: expect.stringContaining('matching P-256 key pair'),
        }),
      ]))
    })

    it.each([
      ['NEXT_PUBLIC_VAPID_PUBLIC_KEY', `${TEST_VAPID_PUBLIC_KEY}=`],
      ['NEXT_PUBLIC_VAPID_PUBLIC_KEY', Buffer.alloc(65, 3).toString('base64url')],
      ['VAPID_PRIVATE_KEY', `${TEST_VAPID_PRIVATE_KEY}=`],
      ['VAPID_PRIVATE_KEY', Buffer.alloc(31, 9).toString('base64url')],
      ['VAPID_PRIVATE_KEY', Buffer.alloc(32).toString('base64url')],
    ])('rejects malformed VAPID key material in %s', async (key, malformed) => {
      setEnv({
        NEXT_PUBLIC_VAPID_PUBLIC_KEY: TEST_VAPID_PUBLIC_KEY,
        VAPID_PRIVATE_KEY: TEST_VAPID_PRIVATE_KEY,
        VAPID_SUBJECT: 'mailto:push@agendita.cl',
        ENCRYPTION_KEY: 'encryption-key',
        [key]: malformed,
      })
      const { validateEnv } = await import('@/lib/env')

      const { errors } = validateEnv()

      expect(errors).toEqual(expect.arrayContaining([
        expect.objectContaining({ key }),
      ]))
    })

    it('returns empty errors and warnings when all required envs are set', async () => {
      setEnv({
        NODE_ENV: 'development',
        DATABASE_URL: 'postgresql://localhost/test',
        DIRECT_URL: 'postgresql://localhost/test',
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
        DIRECT_URL: 'postgresql://localhost/test',
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
      const serviceRoleWarning = warnings.find(
        (w) => w.key === 'SUPABASE_SERVICE_ROLE_KEY',
      )
      expect(serviceRoleWarning).toBeDefined()
    })

    it('reports missing required envs as errors', async () => {
      setEnv({
        NODE_ENV: 'development',
        DATABASE_URL: undefined,
        DIRECT_URL: undefined,
        NEXT_PUBLIC_SUPABASE_URL: undefined,
        NEXT_PUBLIC_SUPABASE_ANON_KEY: undefined,
        APP_DOMAIN: undefined,
        NEXT_PUBLIC_APP_DOMAIN: undefined,
        PAYMENT_PROVIDER: undefined,
      })
      const { validateEnv } = await import('@/lib/env')
      const { errors } = validateEnv()
      expect(errors.length).toBeGreaterThanOrEqual(6)
      const keys = errors.map((e) => e.key)
      expect(keys).toContain('DATABASE_URL')
      expect(keys).toContain('DIRECT_URL')
      expect(keys).toContain('NEXT_PUBLIC_SUPABASE_URL')
      expect(keys).toContain('NEXT_PUBLIC_SUPABASE_ANON_KEY')
      expect(keys).toContain('APP_DOMAIN')
      expect(keys).toContain('NEXT_PUBLIC_APP_DOMAIN')
    })

    it('reports invalid PAYMENT_PROVIDER as error', async () => {
      setEnv({
        NODE_ENV: 'development',
        DATABASE_URL: 'postgresql://localhost/test',
        DIRECT_URL: 'postgresql://localhost/test',
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

    it('warns when PAYMENT_PROVIDER is missing and no OAuth configured', async () => {
      setEnv({
        NODE_ENV: 'development',
        DATABASE_URL: 'postgresql://localhost/test',
        DIRECT_URL: 'postgresql://localhost/test',
        NEXT_PUBLIC_SUPABASE_URL: 'https://test.supabase.co',
        NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key',
        APP_DOMAIN: 'localhost:3000',
        NEXT_PUBLIC_APP_DOMAIN: 'localhost:3000',
        PAYMENT_PROVIDER: undefined,
        MERCADO_PAGO_CLIENT_ID: undefined,
        MERCADO_PAGO_CLIENT_SECRET: undefined,
        MERCADO_PAGO_REDIRECT_URI: undefined,
      })
      const { validateEnv } = await import('@/lib/env')
      const { warnings } = validateEnv()
      const paymentWarning = warnings.find((e) => e.key === 'PAYMENT_PROVIDER')
      expect(paymentWarning).toBeDefined()
      expect(paymentWarning!.message).toContain(
        'PAYMENT_PROVIDER is not configured',
      )
    })

    it('requires PAYMENT_PROVIDER in production', async () => {
      setEnv({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://db/test',
        DIRECT_URL: 'postgresql://db/test',
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
      expect(paymentError!.message).toContain('required')
    })

    it('requires the global Mercado Pago token for OAuth-only webhooks in production', async () => {
      setEnv({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://db/test',
        DIRECT_URL: 'postgresql://db/test',
        NEXT_PUBLIC_SUPABASE_URL: 'https://test.supabase.co',
        NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key',
        APP_DOMAIN: 'app.agendita.com',
        NEXT_PUBLIC_APP_DOMAIN: 'app.agendita.com',
        PAYMENT_PROVIDER: undefined,
        MERCADO_PAGO_CLIENT_ID: 'client-id',
        MERCADO_PAGO_CLIENT_SECRET: 'client-secret',
        MERCADO_PAGO_REDIRECT_URI: 'https://app.agendita.com/callback',
        MERCADO_PAGO_ACCESS_TOKEN: undefined,
        MERCADO_PAGO_WEBHOOK_SECRET: 'webhook-secret',
        ENCRYPTION_KEY: 'encryption-key',
      })
      const { validateEnv } = await import('@/lib/env')
      const { errors } = validateEnv()

      expect(errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ key: 'MERCADO_PAGO_ACCESS_TOKEN' }),
        ]),
      )
    })

    it('mock blocked in production without ALLOW_MOCK override', async () => {
      setEnv({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://db/test',
        DIRECT_URL: 'postgresql://db/test',
        NEXT_PUBLIC_SUPABASE_URL: 'https://test.supabase.co',
        NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key',
        APP_DOMAIN: 'app.agendita.com',
        NEXT_PUBLIC_APP_DOMAIN: 'app.agendita.com',
        PAYMENT_PROVIDER: 'mock',
        ALLOW_MOCK_PAYMENTS_IN_PRODUCTION: 'invalid',
      })
      const { validateEnv } = await import('@/lib/env')
      const { errors } = validateEnv()
      // When ALLOW_MOCK is not a strict boolean, mock is blocked
      const mockError = errors.find(
        (e) => e.key === 'ALLOW_MOCK_PAYMENTS_IN_PRODUCTION',
      )
      expect(mockError).toBeDefined()
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
      expect(() => getOptionalEnvBoolean('TEST_BOOL')).toThrow(
        /Invalid boolean/,
      )
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
