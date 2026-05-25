/**
 * Server-side environment validation.
 * All helpers are synchronous and safe to call from server actions / API routes.
 * Do NOT import this from client components - it reads secrets.
 */

export type EnvValidationError = {
  key: string
  message: string
}

export type EnvValidationResult = {
  errors: EnvValidationError[]
  warnings: EnvValidationError[]
}

const VALID_PAYMENT_PROVIDERS = ['mock', 'manual', 'mercado_pago', 'webpay'] as const
export type PaymentProvider = typeof VALID_PAYMENT_PROVIDERS[number]

function isValidUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

function isStrictBoolean(value: string): boolean {
  const lower = value.toLowerCase()
  return lower === 'true' || lower === 'false'
}

function hasPath(value: string): boolean {
  const clean = value.replace(/^https?:\/\//, '').replace(/\/$/, '')
  return clean.includes('/')
}

function optionalString(value: string | undefined): string | undefined {
  return value || undefined
}

export function getRequiredEnv(key: string): string {
  const value = process.env[key]
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`)
  }
  return value
}

export function getOptionalEnv(key: string): string | undefined {
  return optionalString(process.env[key])
}

export function getOptionalEnvBoolean(key: string): boolean | undefined {
  const raw = optionalString(process.env[key])
  if (!raw) return undefined
  if (!isStrictBoolean(raw)) {
    throw new Error(`Invalid boolean value for ${key}: "${raw}". Expected "true" or "false".`)
  }
  return raw.toLowerCase() === 'true'
}

/**
 * Validates required environment variables.
 * Returns { errors, warnings } — never throws, never logs to console.
 * Callers decide how to surface the results.
 */
export function validateEnv(): EnvValidationResult {
  const errors: EnvValidationError[] = []
  const warnings: EnvValidationError[] = []

  const isProduction = (process.env.NODE_ENV || 'development') === 'production'

  // --- Always required ---
  const alwaysRequired = [
    'DATABASE_URL',
    'DIRECT_URL',
    'NEXT_PUBLIC_SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    'APP_DOMAIN',
    'NEXT_PUBLIC_APP_DOMAIN',
  ]

  for (const key of alwaysRequired) {
    if (!process.env[key]) {
      errors.push({ key, message: `${key} is required` })
    }
  }

  // --- PAYMENT_PROVIDER: opcional en multi-tenant (OAuth por negocio) ---
  // Si no hay PAYMENT_PROVIDER pero si Mercado Pago OAuth envs, es multi-tenant válido.
  const hasMpOAuth =
    !!process.env.MERCADO_PAGO_CLIENT_ID &&
    !!process.env.MERCADO_PAGO_CLIENT_SECRET &&
    !!process.env.MERCADO_PAGO_REDIRECT_URI
  if (!process.env.PAYMENT_PROVIDER && !hasMpOAuth) {
    warnings.push({
      key: 'PAYMENT_PROVIDER',
      message: 'PAYMENT_PROVIDER is not configured. Set it to manual for dashboard-only reservations, or configure Mercado Pago OAuth for multi-tenant online payments.',
    })
  }

  // --- Format validation: APP_DOMAIN ---
  const appDomain = process.env.APP_DOMAIN
  if (appDomain && hasPath(appDomain)) {
    errors.push({
      key: 'APP_DOMAIN',
      message: `APP_DOMAIN="${appDomain}" must not contain a path. Use hostname only.`,
    })
  }

  // --- Format validation: NEXT_PUBLIC_APP_DOMAIN ---
  const pubAppDomain = process.env.NEXT_PUBLIC_APP_DOMAIN
  if (pubAppDomain && hasPath(pubAppDomain)) {
    errors.push({
      key: 'NEXT_PUBLIC_APP_DOMAIN',
      message: `NEXT_PUBLIC_APP_DOMAIN="${pubAppDomain}" must not contain a path. Use hostname only.`,
    })
  }

  // --- Format validation: NEXT_PUBLIC_SUPABASE_URL ---
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (supabaseUrl && !isValidUrl(supabaseUrl)) {
    errors.push({
      key: 'NEXT_PUBLIC_SUPABASE_URL',
      message: `NEXT_PUBLIC_SUPABASE_URL="${supabaseUrl}" is not a valid URL.`,
    })
  }

  // --- PAYMENT_PROVIDER enum ---
  const configured = process.env.PAYMENT_PROVIDER
  if (configured && !VALID_PAYMENT_PROVIDERS.includes(configured as PaymentProvider)) {
    errors.push({
      key: 'PAYMENT_PROVIDER',
      message: `PAYMENT_PROVIDER="${configured}" is invalid. Must be one of: ${VALID_PAYMENT_PROVIDERS.join(', ')}`,
    })
  }

  // --- PAYMENT_PROVIDER required in production unless OAuth is configured ---
  if (isProduction && !configured && !hasMpOAuth) {
    errors.push({
      key: 'PAYMENT_PROVIDER',
      message: 'PAYMENT_PROVIDER is required in production. Set it to manual for dashboard-only reservations, or configure Mercado Pago OAuth (CLIENT_ID, CLIENT_SECRET, REDIRECT_URI).',
    })
  }

  // --- Mock blocked in production unless explicit override ---
  if (isProduction && configured === 'mock') {
    const allowMock = process.env.ALLOW_MOCK_PAYMENTS_IN_PRODUCTION
    if (!allowMock || !isStrictBoolean(allowMock)) {
      errors.push({
        key: 'ALLOW_MOCK_PAYMENTS_IN_PRODUCTION',
        message: 'Mock payments are not allowed in production. Set ALLOW_MOCK_PAYMENTS_IN_PRODUCTION=true to override.',
      })
    } else if (allowMock.toLowerCase() !== 'true') {
      errors.push({
        key: 'ALLOW_MOCK_PAYMENTS_IN_PRODUCTION',
        message: 'Mock payments are not allowed in production.',
      })
    }
  }

  // --- ALLOW_MOCK_PAYMENTS_IN_PRODUCTION format ---
  const allowMock = process.env.ALLOW_MOCK_PAYMENTS_IN_PRODUCTION
  if (allowMock !== undefined && !isStrictBoolean(allowMock)) {
    errors.push({
      key: 'ALLOW_MOCK_PAYMENTS_IN_PRODUCTION',
      message: `ALLOW_MOCK_PAYMENTS_IN_PRODUCTION="${allowMock}" is invalid. Must be "true" or "false".`,
    })
  }

  // --- Mercado Pago in production ---
  if (isProduction && configured === 'mercado_pago') {
    if (!hasMpOAuth && !process.env.MERCADO_PAGO_ACCESS_TOKEN) {
      errors.push({
        key: 'MERCADO_PAGO_ACCESS_TOKEN',
        message: 'MERCADO_PAGO_ACCESS_TOKEN is required in production with Mercado Pago (or configure OAuth: CLIENT_ID, CLIENT_SECRET, REDIRECT_URI)',
      })
    }
    if (!process.env.MERCADO_PAGO_WEBHOOK_SECRET) {
      errors.push({
        key: 'MERCADO_PAGO_WEBHOOK_SECRET',
        message: 'MERCADO_PAGO_WEBHOOK_SECRET is required in production with Mercado Pago',
      })
    }
    if (!process.env.ENCRYPTION_KEY) {
      errors.push({
        key: 'ENCRYPTION_KEY',
        message: 'ENCRYPTION_KEY is required in production with Mercado Pago for per-business token encryption',
      })
    }
  } else if (isProduction && hasMpOAuth && !configured) {
    if (!process.env.MERCADO_PAGO_WEBHOOK_SECRET) {
      errors.push({
        key: 'MERCADO_PAGO_WEBHOOK_SECRET',
        message: 'MERCADO_PAGO_WEBHOOK_SECRET is required in production with Mercado Pago OAuth',
      })
    }
    if (!process.env.ENCRYPTION_KEY) {
      errors.push({
        key: 'ENCRYPTION_KEY',
        message: 'ENCRYPTION_KEY is required in production with Mercado Pago for per-business token encryption',
      })
    }
  }

  // --- Email in production ---
  if (isProduction) {
    const hasResendKey = !!process.env.RESEND_API_KEY
    const hasFromEmail = !!process.env.FROM_EMAIL
    if (hasResendKey !== hasFromEmail) {
      if (!hasFromEmail) {
        warnings.push({
          key: 'FROM_EMAIL',
          message: 'FROM_EMAIL is not set. Transactional emails may not include a valid sender.',
        })
      }
      if (!hasResendKey) {
        warnings.push({
          key: 'RESEND_API_KEY',
          message: 'RESEND_API_KEY is not set. Email notifications will fail.',
        })
      }
    }
  }

  // --- Upstash Redis in production (only supported Redis provider) ---
  if (isProduction) {
    const hasUpstashUrl = !!process.env.UPSTASH_REDIS_REST_URL
    const hasUpstashToken = !!process.env.UPSTASH_REDIS_REST_TOKEN
    if (!hasUpstashUrl || !hasUpstashToken) {
      errors.push({
        key: 'UPSTASH_REDIS_REST_URL',
        message: 'UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are required in production for rate limiting',
      })
    }
  }

  // --- Warning (not error): SUPABASE_SERVICE_ROLE_KEY is optional ---
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    warnings.push({
      key: 'SUPABASE_SERVICE_ROLE_KEY',
      message: 'SUPABASE_SERVICE_ROLE_KEY is not set. Server-side Supabase operations may fail.',
    })
  }

  return { errors, warnings }
}

/**
 * Throws if critical environment errors exist.
 * Call at server startup / build time from a server-only context.
 * Safe to call multiple times (idempotent after first call).
 */
export function assertValidEnv(): void {
  const { errors } = validateEnv()
  if (errors.length > 0) {
    const messages = errors.map(e => `  - ${e.key}: ${e.message}`).join('\n')
    throw new Error(
      `Environment validation failed:\n${messages}\n\nFix these environment issues before starting the server.`
    )
  }
}

/**
 * Safe env getters - these never read secrets, can be used anywhere.
 */

export function getPublicAppDomain(): string {
  const raw = process.env.NEXT_PUBLIC_APP_DOMAIN || process.env.APP_DOMAIN || 'localhost:3000'
  return raw.replace(/^https?:\/\//, '').replace(/\/$/, '')
}

export function getPublicSupabaseUrl(): string {
  return process.env.NEXT_PUBLIC_SUPABASE_URL || ''
}

export function getPublicSupabaseAnonKey(): string {
  return process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
}

export function getNodeEnv(): string {
  return process.env.NODE_ENV || 'development'
}

export function isProduction(): boolean {
  return getNodeEnv() === 'production'
}
