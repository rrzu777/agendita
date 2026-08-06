import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const scriptPath = resolve(process.cwd(), 'scripts/validate-env.js')

describe('build environment validation', () => {
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
