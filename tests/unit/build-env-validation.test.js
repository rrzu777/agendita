import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const scriptPath = resolve(process.cwd(), 'scripts/validate-env.js')

describe('build environment validation', () => {
  it('rejects enabled subscriptions without the selected environment credentials', () => {
    const env = {
      ...process.env,
      NODE_ENV: 'development',
      DATABASE_URL: 'postgresql://localhost/test',
      DIRECT_URL: 'postgresql://localhost/test',
      NEXT_PUBLIC_SUPABASE_URL: 'https://test.supabase.co',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key',
      APP_DOMAIN: 'app.agendita.com',
      NEXT_PUBLIC_APP_DOMAIN: 'app.agendita.com',
      PAYMENT_PROVIDER: 'manual',
      MP_SUBSCRIPTIONS_ENABLED: 'true',
      MERCADO_PAGO_ENVIRONMENT: 'sandbox',
      MERCADO_PAGO_ACCESS_TOKEN: 'generic-token-must-not-be-used',
      MERCADO_PAGO_SANDBOX_ACCESS_TOKEN: '',
      MERCADO_PAGO_SANDBOX_WEBHOOK_SECRET: '',
      MERCADO_PAGO_SANDBOX_SUBSCRIPTIONS_CALLBACK_URL: '',
    }

    const result = spawnSync(process.execPath, [scriptPath], {
      env,
      encoding: 'utf8',
    })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('MISSING: MERCADO_PAGO_SANDBOX_ACCESS_TOKEN')
    expect(result.stderr).toContain('MISSING: MERCADO_PAGO_SANDBOX_WEBHOOK_SECRET')
    expect(result.stderr).toContain(
      'MISSING: MERCADO_PAGO_SANDBOX_SUBSCRIPTIONS_CALLBACK_URL',
    )
  })

  it('does not accept public environment variables for subscriptions credentials', () => {
    const env = {
      ...process.env,
      NODE_ENV: 'development',
      DATABASE_URL: 'postgresql://localhost/test',
      DIRECT_URL: 'postgresql://localhost/test',
      NEXT_PUBLIC_SUPABASE_URL: 'https://test.supabase.co',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key',
      APP_DOMAIN: 'app.agendita.com',
      NEXT_PUBLIC_APP_DOMAIN: 'app.agendita.com',
      PAYMENT_PROVIDER: 'manual',
      MP_SUBSCRIPTIONS_ENABLED: 'true',
      MERCADO_PAGO_ENVIRONMENT: 'sandbox',
      NEXT_PUBLIC_MERCADO_PAGO_SANDBOX_ACCESS_TOKEN: 'must-not-be-a-secret',
      NEXT_PUBLIC_MERCADO_PAGO_SANDBOX_WEBHOOK_SECRET: 'must-not-be-a-secret',
      NEXT_PUBLIC_MERCADO_PAGO_SANDBOX_SUBSCRIPTIONS_CALLBACK_URL:
        'https://public.example.com/callback',
    }
    delete env.MERCADO_PAGO_SANDBOX_ACCESS_TOKEN
    delete env.MERCADO_PAGO_SANDBOX_WEBHOOK_SECRET
    delete env.MERCADO_PAGO_SANDBOX_SUBSCRIPTIONS_CALLBACK_URL

    const result = spawnSync(process.execPath, [scriptPath], {
      env,
      encoding: 'utf8',
    })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('MISSING: MERCADO_PAGO_SANDBOX_ACCESS_TOKEN')
  })

  it('rejects an unsupported Mercado Pago environment when it is configured', () => {
    const env = {
      ...process.env,
      NODE_ENV: 'development',
      DATABASE_URL: 'postgresql://localhost/test',
      DIRECT_URL: 'postgresql://localhost/test',
      NEXT_PUBLIC_SUPABASE_URL: 'https://test.supabase.co',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key',
      APP_DOMAIN: 'app.agendita.com',
      NEXT_PUBLIC_APP_DOMAIN: 'app.agendita.com',
      PAYMENT_PROVIDER: 'manual',
      MP_SUBSCRIPTIONS_ENABLED: 'false',
      MERCADO_PAGO_ENVIRONMENT: 'development',
    }

    const result = spawnSync(process.execPath, [scriptPath], {
      env,
      encoding: 'utf8',
    })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('MERCADO_PAGO_ENVIRONMENT')
  })

  it('rejects a non-HTTPS subscriptions callback', () => {
    const env = {
      ...process.env,
      NODE_ENV: 'development',
      DATABASE_URL: 'postgresql://localhost/test',
      DIRECT_URL: 'postgresql://localhost/test',
      NEXT_PUBLIC_SUPABASE_URL: 'https://test.supabase.co',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key',
      APP_DOMAIN: 'app.agendita.com',
      NEXT_PUBLIC_APP_DOMAIN: 'app.agendita.com',
      PAYMENT_PROVIDER: 'manual',
      MP_SUBSCRIPTIONS_ENABLED: 'true',
      MERCADO_PAGO_ENVIRONMENT: 'sandbox',
      MERCADO_PAGO_SANDBOX_ACCESS_TOKEN: 'sandbox-token',
      MERCADO_PAGO_SANDBOX_WEBHOOK_SECRET: 'sandbox-secret',
      MERCADO_PAGO_SANDBOX_SUBSCRIPTIONS_CALLBACK_URL: 'http://example.com/callback',
    }

    const result = spawnSync(process.execPath, [scriptPath], { env, encoding: 'utf8' })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('MERCADO_PAGO_SANDBOX_SUBSCRIPTIONS_CALLBACK_URL')
  })

  it('requires an explicit environment and exact canonical OAuth callback', () => {
    const env = {
      ...process.env,
      NODE_ENV: 'development',
      DATABASE_URL: 'postgresql://localhost/test',
      DIRECT_URL: 'postgresql://localhost/test',
      NEXT_PUBLIC_SUPABASE_URL: 'https://test.supabase.co',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key',
      APP_DOMAIN: 'app.agendita.com',
      NEXT_PUBLIC_APP_DOMAIN: 'app.agendita.com',
      PAYMENT_PROVIDER: 'manual',
      MERCADO_PAGO_CLIENT_ID: 'client-id',
      MERCADO_PAGO_CLIENT_SECRET: 'client-secret',
      MERCADO_PAGO_REDIRECT_URI: 'https://www.app.agendita.com/api/mercado-pago/callback?bad=1',
      MERCADO_PAGO_ENVIRONMENT: '',
    }

    const result = spawnSync(process.execPath, [scriptPath], { env, encoding: 'utf8' })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('MERCADO_PAGO_ENVIRONMENT')
    expect(result.stderr).toContain('MERCADO_PAGO_REDIRECT_URI')
  })

  it('rejects partial OAuth configuration at build time', () => {
    const env = {
      ...process.env,
      NODE_ENV: 'development',
      DATABASE_URL: 'postgresql://localhost/test',
      DIRECT_URL: 'postgresql://localhost/test',
      NEXT_PUBLIC_SUPABASE_URL: 'https://test.supabase.co',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key',
      APP_DOMAIN: 'app.agendita.com',
      NEXT_PUBLIC_APP_DOMAIN: 'app.agendita.com',
      PAYMENT_PROVIDER: 'manual',
      MERCADO_PAGO_CLIENT_ID: 'client-id',
      MERCADO_PAGO_CLIENT_SECRET: '',
      MERCADO_PAGO_REDIRECT_URI: 'https://app.agendita.com/callback',
    }

    const result = spawnSync(process.execPath, [scriptPath], { env, encoding: 'utf8' })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('MERCADO_PAGO_CLIENT_SECRET')
  })

  it('accepts complete production subscriptions credentials and a false enforcement flag', () => {
    const env = {
      ...process.env,
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://localhost/test',
      DIRECT_URL: 'postgresql://localhost/test',
      NEXT_PUBLIC_SUPABASE_URL: 'https://test.supabase.co',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key',
      APP_DOMAIN: 'app.agendita.com',
      NEXT_PUBLIC_APP_DOMAIN: 'app.agendita.com',
      PAYMENT_PROVIDER: 'manual',
      UPSTASH_REDIS_REST_URL: 'https://redis.example.com',
      UPSTASH_REDIS_REST_TOKEN: 'redis-token',
      MP_SUBSCRIPTIONS_ENABLED: 'true',
      MERCADO_PAGO_ENVIRONMENT: 'production',
      MERCADO_PAGO_PRODUCTION_ACCESS_TOKEN: 'production-token',
      MERCADO_PAGO_PRODUCTION_WEBHOOK_SECRET: 'production-webhook-secret',
      MERCADO_PAGO_PRODUCTION_SUBSCRIPTIONS_CALLBACK_URL:
        'https://app.agendita.com/api/mercado-pago/subscriptions/callback',
      SUBSCRIPTION_ENFORCEMENT_ENABLED: 'false',
    }

    const result = spawnSync(process.execPath, [scriptPath], {
      env,
      encoding: 'utf8',
    })

    expect(result.status).toBe(0)
  })

  it('rejects a malformed enforcement flag even when subscriptions are disabled', () => {
    const env = {
      ...process.env,
      NODE_ENV: 'development',
      DATABASE_URL: 'postgresql://localhost/test',
      DIRECT_URL: 'postgresql://localhost/test',
      NEXT_PUBLIC_SUPABASE_URL: 'https://test.supabase.co',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key',
      APP_DOMAIN: 'app.agendita.com',
      NEXT_PUBLIC_APP_DOMAIN: 'app.agendita.com',
      PAYMENT_PROVIDER: 'manual',
      MP_SUBSCRIPTIONS_ENABLED: 'false',
      SUBSCRIPTION_ENFORCEMENT_ENABLED: 'yes',
    }

    const result = spawnSync(process.execPath, [scriptPath], {
      env,
      encoding: 'utf8',
    })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('SUBSCRIPTION_ENFORCEMENT_ENABLED')
  })

  it('rejects OAuth-only Mercado Pago without the global webhook lookup token', () => {
    const env = {
      ...process.env,
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://localhost/test',
      DIRECT_URL: 'postgresql://localhost/test',
      NEXT_PUBLIC_SUPABASE_URL: 'https://test.supabase.co',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key',
      APP_DOMAIN: 'app.agendita.com',
      NEXT_PUBLIC_APP_DOMAIN: 'app.agendita.com',
      PAYMENT_PROVIDER: '',
      MERCADO_PAGO_CLIENT_ID: 'client-id',
      MERCADO_PAGO_CLIENT_SECRET: 'client-secret',
      MERCADO_PAGO_REDIRECT_URI: 'https://app.agendita.com/callback',
      MERCADO_PAGO_ACCESS_TOKEN: '',
      MERCADO_PAGO_WEBHOOK_SECRET: 'webhook-secret',
      ENCRYPTION_KEY: 'encryption-key',
      UPSTASH_REDIS_REST_URL: 'https://redis.example.com',
      UPSTASH_REDIS_REST_TOKEN: 'redis-token',
    }

    const result = spawnSync(process.execPath, [scriptPath], {
      env,
      encoding: 'utf8',
    })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('MISSING: MERCADO_PAGO_ACCESS_TOKEN')
  })
})
