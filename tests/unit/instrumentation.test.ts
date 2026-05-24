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

afterEach(() => {
  process.env = { ...originalEnv }
  vi.resetModules()
})

describe('assertValidEnv integration via instrumentation', () => {
  // instrumentation.ts only runs assertValidEnv when:
  // - NEXT_RUNTIME === 'nodejs' (Node.js, not Edge)
  // - NODE_ENV === 'production'
  // This ensures dev/test/e2e are unaffected.

  it('skips validation in development (NEXT_RUNTIME=nodejs, NODE_ENV=development)', async () => {
    setEnv({
      NEXT_RUNTIME: 'nodejs',
      NODE_ENV: 'development',
      DATABASE_URL: 'postgresql://localhost/test',
      DIRECT_URL: 'postgresql://localhost/test',
      NEXT_PUBLIC_SUPABASE_URL: 'https://test.supabase.co',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key',
      APP_DOMAIN: 'localhost:3000',
      NEXT_PUBLIC_APP_DOMAIN: 'localhost:3000',
      PAYMENT_PROVIDER: 'mock',
    })
    // Should not throw — instrumentation skips assertValidEnv in dev
    const { register } = await import('@/instrumentation')
    await expect(register()).resolves.not.toThrow()
  })

  it('skips validation when NEXT_RUNTIME is not nodejs', async () => {
    setEnv({
      NEXT_RUNTIME: 'edge',
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://localhost/test',
      DIRECT_URL: 'postgresql://localhost/test',
      NEXT_PUBLIC_SUPABASE_URL: 'https://test.supabase.co',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key',
      APP_DOMAIN: 'localhost:3000',
      NEXT_PUBLIC_APP_DOMAIN: 'localhost:3000',
      PAYMENT_PROVIDER: 'mock',
    })
    // Edge runtime → skip validation
    const { register } = await import('@/instrumentation')
    await expect(register()).resolves.not.toThrow()
  })

  it('calls assertValidEnv and throws when env is invalid (production, nodejs)', async () => {
    setEnv({
      NEXT_RUNTIME: 'nodejs',
      NODE_ENV: 'production',
      DATABASE_URL: undefined,
      DIRECT_URL: undefined,
      NEXT_PUBLIC_SUPABASE_URL: undefined,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: undefined,
      APP_DOMAIN: undefined,
      NEXT_PUBLIC_APP_DOMAIN: undefined,
      PAYMENT_PROVIDER: undefined,
    })
    const { register } = await import('@/instrumentation')
    await expect(register()).rejects.toThrow(/Environment validation failed/)
  })

  it('passes when env is valid (production, nodejs)', async () => {
    setEnv({
      NEXT_RUNTIME: 'nodejs',
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://localhost/test',
      DIRECT_URL: 'postgresql://localhost/test',
      NEXT_PUBLIC_SUPABASE_URL: 'https://test.supabase.co',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key',
      APP_DOMAIN: 'localhost:3000',
      NEXT_PUBLIC_APP_DOMAIN: 'localhost:3000',
      PAYMENT_PROVIDER: 'mock',
      ALLOW_MOCK_PAYMENTS_IN_PRODUCTION: 'true',
      UPSTASH_REDIS_REST_URL: 'https://test.upstash.io',
      UPSTASH_REDIS_REST_TOKEN: 'test-token',
    })
    const { register } = await import('@/instrumentation')
    await expect(register()).resolves.not.toThrow()
  })
})