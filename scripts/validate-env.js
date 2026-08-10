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
// eslint-disable-next-line @typescript-eslint/no-require-imports
const vapidValidation = require('../src/lib/push/vapid-validation')
const {
  isMatchingVapidKeyPair,
  isValidVapidPrivateKey,
  isValidVapidPublicKey,
} = vapidValidation

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

  // ── PAYMENT_PROVIDER — warning, no bloquea build (beta) ──────────────────
  const provider = getEnv('PAYMENT_PROVIDER')
  const hasMpOAuth =
    !!getEnv('MERCADO_PAGO_CLIENT_ID') &&
    !!getEnv('MERCADO_PAGO_CLIENT_SECRET') &&
    !!getEnv('MERCADO_PAGO_REDIRECT_URI')

  if (!provider && !hasMpOAuth) {
    console.warn(
      '⚠  PAYMENT_PROVIDER not configured. Online payments disabled. Set to manual for dashboard-only reservations.',
    )
  } else if (provider && !VALID_PAYMENT_PROVIDERS.includes(provider)) {
    errors.push(
      `Invalid PAYMENT_PROVIDER: "${provider}". Must be one of: ${VALID_PAYMENT_PROVIDERS.join(', ')}`,
    )
  }

  // ── APP_DOMAIN format ──────────────────────────────────────────────────
  const appDomain = getEnv('APP_DOMAIN')
  if (appDomain && hasPath(appDomain)) {
    errors.push('APP_DOMAIN must not contain a path. Use hostname only.')
  }

  const pubAppDomain = getEnv('NEXT_PUBLIC_APP_DOMAIN')
  if (pubAppDomain && hasPath(pubAppDomain)) {
    errors.push(
      'NEXT_PUBLIC_APP_DOMAIN must not contain a path. Use hostname only.',
    )
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
        'ALLOW_MOCK_PAYMENTS_IN_PRODUCTION must be "true" or "false" in production when PAYMENT_PROVIDER=mock.',
      )
    } else if (allowMock.toLowerCase() !== 'true') {
      errors.push(
        'PAYMENT_PROVIDER=mock in production requires ALLOW_MOCK_PAYMENTS_IN_PRODUCTION=true.',
      )
    }
  }

  // ── Mercado Pago in production ─────────────────────────────────────────
  // OAuth enables per-business checkout, but the webhook still needs the
  // global token for its initial payment lookup before the business is known.
  const mercadoPagoEnabled =
    provider === 'mercado_pago' || (!provider && hasMpOAuth)
  if (isProduction && mercadoPagoEnabled) {
    if (!getEnv('MERCADO_PAGO_ACCESS_TOKEN')) {
      errors.push(
        'MISSING: MERCADO_PAGO_ACCESS_TOKEN (required for the initial webhook payment lookup)',
      )
    }
    if (!getEnv('MERCADO_PAGO_WEBHOOK_SECRET')) {
      errors.push(
        'MISSING: MERCADO_PAGO_WEBHOOK_SECRET (required in production with Mercado Pago)',
      )
    }
    if (!getEnv('ENCRYPTION_KEY')) {
      errors.push(
        'MISSING: ENCRYPTION_KEY (required in production with Mercado Pago for token encryption)',
      )
    }
  }

  // ── Web Push — optional, but the VAPID trio is atomic ──────────────────
  // Read secret names directly. Falling back to NEXT_PUBLIC_* for private
  // credentials would make an accidentally exposed secret look valid.
  const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || ''
  const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY || ''
  const vapidSubject = process.env.VAPID_SUBJECT || ''
  const vapidPresent = [vapidPublicKey, vapidPrivateKey, vapidSubject].filter(Boolean)
  if (vapidPresent.length > 0 && vapidPresent.length < 3) {
    errors.push(
      `Web Push configuration is incomplete (${vapidPresent.length}/3). Configure all VAPID variables together or remove all of them.`,
    )
  }
  if (vapidPresent.length === 3) {
    if (!process.env.ENCRYPTION_KEY) {
      errors.push('MISSING: ENCRYPTION_KEY (required when Web Push is enabled)')
    }
    const validVapidPublicKey = isValidVapidPublicKey(vapidPublicKey)
    const validVapidPrivateKey = isValidVapidPrivateKey(vapidPrivateKey)
    if (!validVapidPublicKey) {
      errors.push('NEXT_PUBLIC_VAPID_PUBLIC_KEY must be a canonical base64url uncompressed P-256 public key')
    }
    if (!validVapidPrivateKey) {
      errors.push('VAPID_PRIVATE_KEY must be a canonical base64url P-256 private key')
    }
    if (
      validVapidPublicKey
      && validVapidPrivateKey
      && !isMatchingVapidKeyPair(vapidPublicKey, vapidPrivateKey)
    ) {
      errors.push('NEXT_PUBLIC_VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY must form a matching P-256 key pair')
    }
    const validMailto = /^mailto:[^@\s]+@[^@\s]+$/i.test(vapidSubject)
    let validHttps = false
    try {
      const subjectUrl = new URL(vapidSubject)
      validHttps = subjectUrl.protocol === 'https:' && subjectUrl.hostname.length > 0
    } catch {
      validHttps = false
    }
    if (!validMailto && !validHttps) {
      errors.push('VAPID_SUBJECT must be a mailto: address or an HTTPS URL')
    }
  }

  // ── Upstash Redis — REQUIRED in production (rate limiting fails closed) ─
  if (isProduction) {
    if (
      !getEnv('UPSTASH_REDIS_REST_URL') ||
      !getEnv('UPSTASH_REDIS_REST_TOKEN')
    ) {
      errors.push(
        'MISSING: UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN (required in production — rate limiting fails closed without a distributed store)',
      )
    }
  }

  // ── ALLOW_MOCK_PAYMENTS_IN_PRODUCTION format ───────────────────────────
  const allowMock = getEnv('ALLOW_MOCK_PAYMENTS_IN_PRODUCTION')
  if (
    allowMock !== undefined &&
    allowMock !== '' &&
    !isStrictBoolean(allowMock)
  ) {
    errors.push(
      `ALLOW_MOCK_PAYMENTS_IN_PRODUCTION="${allowMock}" must be "true" or "false".`,
    )
  }

  // ── Result ────────────────────────────────────────────────────────────
  if (errors.length) {
    console.error('\n❌ Environment validation failed:\n')
    errors.forEach((e) => console.error(`  - ${e}`))
    console.error('\n')
    process.exit(1)
  }

  console.log('✅ Environment validation passed')
  process.exit(0)
}

validate()
