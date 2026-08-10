import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { TEST_VAPID_PRIVATE_KEY, TEST_VAPID_PUBLIC_KEY } from '../helpers/push-fixtures'

const scriptPath = resolve(process.cwd(), 'scripts/validate-env.js')

describe('build environment validation', () => {
  function validBuildEnv(overrides = {}) {
    return {
      ...process.env,
      NODE_ENV: 'development',
      DATABASE_URL: 'postgresql://localhost/test',
      DIRECT_URL: 'postgresql://localhost/test',
      NEXT_PUBLIC_SUPABASE_URL: 'https://test.supabase.co',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key',
      APP_DOMAIN: 'app.agendita.com',
      NEXT_PUBLIC_APP_DOMAIN: 'app.agendita.com',
      PAYMENT_PROVIDER: 'manual',
      NEXT_PUBLIC_VAPID_PUBLIC_KEY: '',
      VAPID_PRIVATE_KEY: '',
      VAPID_SUBJECT: '',
      ENCRYPTION_KEY: '',
      ...overrides,
    }
  }

  it('blocks the build when VAPID configuration is partial', () => {
    const result = spawnSync(process.execPath, [scriptPath], {
      env: validBuildEnv({ NEXT_PUBLIC_VAPID_PUBLIC_KEY: 'public-vapid' }),
      encoding: 'utf8',
    })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('Web Push configuration is incomplete')
  })

  it('blocks the build when Web Push is enabled without encryption', () => {
    const result = spawnSync(process.execPath, [scriptPath], {
      env: validBuildEnv({
        NEXT_PUBLIC_VAPID_PUBLIC_KEY: TEST_VAPID_PUBLIC_KEY,
        VAPID_PRIVATE_KEY: TEST_VAPID_PRIVATE_KEY,
        VAPID_SUBJECT: 'mailto:push@agendita.cl',
      }),
      encoding: 'utf8',
    })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('ENCRYPTION_KEY')
  })

  it('blocks the build for a non-mailto, non-HTTPS VAPID subject', () => {
    const result = spawnSync(process.execPath, [scriptPath], {
      env: validBuildEnv({
        NEXT_PUBLIC_VAPID_PUBLIC_KEY: TEST_VAPID_PUBLIC_KEY,
        VAPID_PRIVATE_KEY: TEST_VAPID_PRIVATE_KEY,
        VAPID_SUBJECT: 'http://agendita.cl',
        ENCRYPTION_KEY: 'encryption-key',
      }),
      encoding: 'utf8',
    })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('VAPID_SUBJECT')
  })

  it.each([
    ['NEXT_PUBLIC_VAPID_PUBLIC_KEY', `${TEST_VAPID_PUBLIC_KEY}=`],
    ['NEXT_PUBLIC_VAPID_PUBLIC_KEY', Buffer.alloc(65, 3).toString('base64url')],
    ['VAPID_PRIVATE_KEY', Buffer.alloc(31, 9).toString('base64url')],
    ['VAPID_PRIVATE_KEY', Buffer.alloc(32).toString('base64url')],
  ])('blocks the build for malformed %s key material', (key, malformed) => {
    const result = spawnSync(process.execPath, [scriptPath], {
      env: validBuildEnv({
        NEXT_PUBLIC_VAPID_PUBLIC_KEY: TEST_VAPID_PUBLIC_KEY,
        VAPID_PRIVATE_KEY: TEST_VAPID_PRIVATE_KEY,
        VAPID_SUBJECT: 'mailto:push@agendita.cl',
        ENCRYPTION_KEY: 'encryption-key',
        [key]: malformed,
      }),
      encoding: 'utf8',
    })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain(key)
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
