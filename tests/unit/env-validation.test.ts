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
    describe('Mercado Pago subscriptions', () => {
      const subscriptionEnv = {
        NODE_ENV: 'development',
        DATABASE_URL: 'postgresql://localhost/test',
        DIRECT_URL: 'postgresql://localhost/test',
        NEXT_PUBLIC_SUPABASE_URL: 'https://test.supabase.co',
        NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key',
        APP_DOMAIN: 'localhost:3000',
        NEXT_PUBLIC_APP_DOMAIN: 'localhost:3000',
        PAYMENT_PROVIDER: 'manual',
        SUPABASE_SERVICE_ROLE_KEY: 'service-key',
        MP_SUBSCRIPTIONS_ENABLED: 'true',
        MERCADO_PAGO_ENVIRONMENT: 'sandbox',
        MERCADO_PAGO_SANDBOX_ACCESS_TOKEN: 'sandbox-token',
        MERCADO_PAGO_SANDBOX_WEBHOOK_SECRET: 'sandbox-webhook-secret',
        MERCADO_PAGO_SANDBOX_SUBSCRIPTIONS_CALLBACK_URL:
          'https://sandbox.example.com/api/webhooks/mercado-pago/subscriptions',
      }

      it('fails closed when an enabled subscriptions transport lacks required sandbox configuration', async () => {
        setEnv({
          ...subscriptionEnv,
          MERCADO_PAGO_SANDBOX_ACCESS_TOKEN: undefined,
          MERCADO_PAGO_SANDBOX_WEBHOOK_SECRET: undefined,
          MERCADO_PAGO_SANDBOX_SUBSCRIPTIONS_CALLBACK_URL: undefined,
        })
        const { validateEnv } = await import('@/lib/env')

        expect(validateEnv().errors).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ key: 'MERCADO_PAGO_SANDBOX_ACCESS_TOKEN' }),
            expect.objectContaining({ key: 'MERCADO_PAGO_SANDBOX_WEBHOOK_SECRET' }),
            expect.objectContaining({
              key: 'MERCADO_PAGO_SANDBOX_SUBSCRIPTIONS_CALLBACK_URL',
            }),
          ]),
        )
      })

      it('rejects an enabled subscriptions transport without an explicit supported environment', async () => {
        setEnv({ ...subscriptionEnv, MERCADO_PAGO_ENVIRONMENT: 'staging' })
        const { validateEnv } = await import('@/lib/env')

        expect(validateEnv().errors).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ key: 'MERCADO_PAGO_ENVIRONMENT' }),
          ]),
        )
      })

      it('rejects an invalid Mercado Pago environment even when subscriptions are disabled', async () => {
        setEnv({
          ...subscriptionEnv,
          MP_SUBSCRIPTIONS_ENABLED: 'false',
          MERCADO_PAGO_ENVIRONMENT: 'staging',
        })
        const { validateEnv } = await import('@/lib/env')

        expect(validateEnv().errors).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ key: 'MERCADO_PAGO_ENVIRONMENT' }),
          ]),
        )
      })

      it('does not accept a generic Mercado Pago token as a sandbox fallback', async () => {
        setEnv({
          ...subscriptionEnv,
          MERCADO_PAGO_SANDBOX_ACCESS_TOKEN: undefined,
          MERCADO_PAGO_ACCESS_TOKEN: 'generic-token-must-not-be-used',
        })
        const { validateEnv } = await import('@/lib/env')

        expect(validateEnv().errors).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ key: 'MERCADO_PAGO_SANDBOX_ACCESS_TOKEN' }),
          ]),
        )
      })

      it('accepts only the selected production credentials when subscriptions are enabled', async () => {
        setEnv({
          ...subscriptionEnv,
          NODE_ENV: 'production',
          MP_SUBSCRIPTIONS_ENABLED: 'true',
          MERCADO_PAGO_ENVIRONMENT: 'production',
          MERCADO_PAGO_PRODUCTION_ACCESS_TOKEN: 'production-token',
          MERCADO_PAGO_PRODUCTION_WEBHOOK_SECRET: 'production-webhook-secret',
          MERCADO_PAGO_PRODUCTION_SUBSCRIPTIONS_CALLBACK_URL:
            'https://app.agendita.com/api/webhooks/mercado-pago/subscriptions',
          UPSTASH_REDIS_REST_URL: 'https://redis.example.com',
          UPSTASH_REDIS_REST_TOKEN: 'redis-token',
        })
        const { validateEnv } = await import('@/lib/env')

        expect(validateEnv().errors).toEqual([])
      })
    })

    describe('subscription enforcement', () => {
      it('fails closed to false when enforcement is absent', async () => {
        setEnv({ SUBSCRIPTION_ENFORCEMENT_ENABLED: undefined })
        const { getSubscriptionEnforcementEnabled } = await import('@/lib/env')
        expect(getSubscriptionEnforcementEnabled()).toBe(false)
      })

      it.each([
        ['true', true],
        ['false', false],
      ] as const)('reads the strict enforcement flag %s', async (configured, expected) => {
        setEnv({ SUBSCRIPTION_ENFORCEMENT_ENABLED: configured })
        const { getSubscriptionEnforcementEnabled } = await import('@/lib/env')
        expect(getSubscriptionEnforcementEnabled()).toBe(expected)
      })

      it('rejects a malformed enforcement flag independently from subscriptions transport', async () => {
        setEnv({ SUBSCRIPTION_ENFORCEMENT_ENABLED: 'enabled' })
        const { getSubscriptionEnforcementEnabled, validateEnv } = await import('@/lib/env')

        expect(() => getSubscriptionEnforcementEnabled()).toThrow(/SUBSCRIPTION_ENFORCEMENT_ENABLED/)
        expect(validateEnv().errors).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ key: 'SUBSCRIPTION_ENFORCEMENT_ENABLED' }),
          ]),
        )
      })
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
