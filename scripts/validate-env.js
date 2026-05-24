#!/usr/bin/env node
/**
 * Validate environment variables before build/deploy.
 * Run: node scripts/validate-env.js
 */

const REQUIRED_IN_PROD = [
  'DATABASE_URL',
  'DIRECT_URL',
  'APP_DOMAIN',
  'PAYMENT_PROVIDER',
]

const OPTIONAL = [
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'UPSTASH_REDIS_REST_URL',
  'UPSTASH_REDIS_REST_TOKEN',
  'RESEND_API_KEY',
  'MERCADO_PAGO_ACCESS_TOKEN',
  'MERCADO_PAGO_WEBHOOK_SECRET',
  'NEXT_PUBLIC_MERCADO_PAGO_PUBLIC_KEY',
  'NEXT_PUBLIC_APP_DOMAIN',
]

const PAYMENT_PROVIDERS = ['mock', 'mercadopago']

function getEnv(key) {
  return process.env[key] ?? process.env[`NEXT_PUBLIC_${key}`] ?? ''
}

function validate() {
  const errors = []

  for (const key of REQUIRED_IN_PROD) {
    if (!getEnv(key)) {
      errors.push(`MISSING: ${key}`)
    }
  }

  const provider = getEnv('PAYMENT_PROVIDER')
  if (provider && !PAYMENT_PROVIDERS.includes(provider)) {
    errors.push(`Invalid PAYMENT_PROVIDER: ${provider}. Must be one of: ${PAYMENT_PROVIDERS.join(', ')}`)
  }

  if (provider === 'mercadopago') {
    if (!getEnv('MERCADO_PAGO_ACCESS_TOKEN')) {
      errors.push('MISSING: MERCADO_PAGO_ACCESS_TOKEN (required when PAYMENT_PROVIDER=mercadopago)')
    }
  }

  const appDomain = getEnv('APP_DOMAIN') || getEnv('NEXT_PUBLIC_APP_DOMAIN')
  if (appDomain) {
    try {
      const url = new URL(appDomain.startsWith('http') ? appDomain : `https://${appDomain}`)
      if (!url.hostname) errors.push('APP_DOMAIN must have a valid hostname')
    } catch {
      errors.push(`Invalid APP_DOMAIN format: ${appDomain}`)
    }
  }

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