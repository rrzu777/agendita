#!/usr/bin/env node
/**
 * Validate environment variables before build/deploy.
 * Replicates the validation rules from src/lib/env.ts to run
 * at build time without TypeScript/Next.js overhead.
 *
 * Run: node scripts/validate-env.js
 *
 * IMPORTANT: Keep this in sync with src/lib/env.ts.
 * Any changes to payment provider rules there must be reflected here.
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { loadEnvConfig } = require('@next/env')

// Load .env.local just like Next.js does during build
loadEnvConfig(process.cwd())

const VALID_PAYMENT_PROVIDERS = ['mock', 'manual', 'mercado_pago', 'webpay']

function getEnv(key) {
  return process.env[key] ?? process.env[`NEXT_PUBLIC_${key}`] ?? ''
}

function isStrictBoolean(value) {
  const lower = (value || '').toLowerCase()
  return lower === 'true' || lower === 'false'
}

function hasPath(value) {
  const clean = value.replace(/^https?:\/\//, '').replace(/\/$/, '')
  return clean.includes('/')
}

function validate() {
  const errors = []
  const isProduction = (process.env.NODE_ENV || 'development') === 'production'

  // ── Always required (always enforced, not just production) ───────────
  const alwaysRequired = [
    'DATABASE_URL',
    'DIRECT_URL',
    'NEXT_PUBLIC_SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    'APP_DOMAIN',
    'NEXT_PUBLIC_APP_DOMAIN',
  ]

  for (const key of alwaysRequired) {
    if (!getEnv(key)) {
      errors.push(`MISSING: ${key}`)
    }
  }

  // ── PAYMENT_PROVIDER — always required ─────────────────────────────────
  const provider = getEnv('PAYMENT_PROVIDER')

  if (!provider) {
    errors.push('MISSING: PAYMENT_PROVIDER')
  } else if (!VALID_PAYMENT_PROVIDERS.includes(provider)) {
    errors.push(
      `Invalid PAYMENT_PROVIDER: "${provider}". Must be one of: ${VALID_PAYMENT_PROVIDERS.join(', ')}`
    )
  }

  // ── APP_DOMAIN format ──────────────────────────────────────────────────
  const appDomain = getEnv('APP_DOMAIN')
  if (appDomain && hasPath(appDomain)) {
    errors.push('APP_DOMAIN must not contain a path. Use hostname only.')
  }

  const pubAppDomain = getEnv('NEXT_PUBLIC_APP_DOMAIN')
  if (pubAppDomain && hasPath(pubAppDomain)) {
    errors.push('NEXT_PUBLIC_APP_DOMAIN must not contain a path. Use hostname only.')
  }

  // ── NEXT_PUBLIC_SUPABASE_URL format ───────────────────────────────────
  const supabaseUrl = getEnv('NEXT_PUBLIC_SUPABASE_URL')
  if (supabaseUrl) {
    try {
      const url = new URL(supabaseUrl)
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        errors.push('NEXT_PUBLIC_SUPABASE_URL must use http or https protocol.')
      }
    } catch {
      errors.push('NEXT_PUBLIC_SUPABASE_URL is not a valid URL.')
    }
  }

  // ── Mock blocked in production ─────────────────────────────────────────
  if (isProduction && provider === 'mock') {
    const allowMock = getEnv('ALLOW_MOCK_PAYMENTS_IN_PRODUCTION')
    if (!allowMock || !isStrictBoolean(allowMock)) {
      errors.push(
        'ALLOW_MOCK_PAYMENTS_IN_PRODUCTION must be "true" or "false" in production when PAYMENT_PROVIDER=mock.'
      )
    } else if (allowMock.toLowerCase() !== 'true') {
      errors.push(
        'PAYMENT_PROVIDER=mock in production requires ALLOW_MOCK_PAYMENTS_IN_PRODUCTION=true.'
      )
    }
  }

  // ── Mercado Pago in production ─────────────────────────────────────────
  if (isProduction && provider === 'mercado_pago') {
    if (!getEnv('MERCADO_PAGO_ACCESS_TOKEN')) {
      errors.push('MISSING: MERCADO_PAGO_ACCESS_TOKEN (required in production with Mercado Pago)')
    }
    if (!getEnv('MERCADO_PAGO_WEBHOOK_SECRET')) {
      errors.push('MISSING: MERCADO_PAGO_WEBHOOK_SECRET (required in production with Mercado Pago)')
    }
  }

  // ── Upstash Redis in production (required for rate limiting) ──────────
  if (isProduction) {
    if (!getEnv('UPSTASH_REDIS_REST_URL') || !getEnv('UPSTASH_REDIS_REST_TOKEN')) {
      errors.push(
        'MISSING: UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are required in production for rate limiting.'
      )
    }
  }

  // ── ALLOW_MOCK_PAYMENTS_IN_PRODUCTION format ───────────────────────────
  const allowMock = getEnv('ALLOW_MOCK_PAYMENTS_IN_PRODUCTION')
  if (allowMock !== undefined && allowMock !== '' && !isStrictBoolean(allowMock)) {
    errors.push(
      `ALLOW_MOCK_PAYMENTS_IN_PRODUCTION="${allowMock}" must be "true" or "false".`
    )
  }

  // ── Result ────────────────────────────────────────────────────────────
  if (errors.length) {
    console.error('\n❌ Environment validation failed:\n')
    errors.forEach(e => console.error(`  - ${e}`))
    console.error('\n')
    process.exit(1)
  }

  console.log('✅ Environment validation passed')
  process.exit(0)
}

validate()