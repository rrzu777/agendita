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
  const lower = raw.toLowerCase()
  if (lower === 'true') return true
  if (lower === 'false') return false
  throw new Error(`Invalid boolean value for ${key}: "${raw}". Expected "true" or "false".`)
}

/**
 * Validates required environment variables.
 * Returns { errors, warnings } — never throws, never logs to console.
 * Callers decide how to surface the results.
 */
export function validateEnv(): EnvValidationResult {
  const errors: EnvValidationError[] = []
  const warnings: EnvValidationError[] = []

  const required = [
    'DATABASE_URL',
    'NEXT_PUBLIC_SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    'APP_DOMAIN',
    'NEXT_PUBLIC_APP_DOMAIN',
  ]

  for (const key of required) {
    if (!process.env[key]) {
      errors.push({ key, message: `${key} is required` })
    }
  }

  const configured = process.env.PAYMENT_PROVIDER
  if (configured) {
    const validProviders = ['mock', 'manual', 'mercado_pago', 'webpay']
    if (!validProviders.includes(configured)) {
      errors.push({
        key: 'PAYMENT_PROVIDER',
        message: `PAYMENT_PROVIDER="${configured}" is invalid. Must be one of: ${validProviders.join(', ')}`,
      })
    }
  }

  const allowMock = process.env.ALLOW_MOCK_PAYMENTS_IN_PRODUCTION
  if (allowMock !== undefined) {
    const lower = allowMock.toLowerCase()
    if (lower !== 'true' && lower !== 'false') {
      errors.push({
        key: 'ALLOW_MOCK_PAYMENTS_IN_PRODUCTION',
        message: `ALLOW_MOCK_PAYMENTS_IN_PRODUCTION="${allowMock}" is invalid. Must be "true" or "false".`,
      })
    }
  }

  // Warning (not error): SUPABASE_SERVICE_ROLE_KEY is optional
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    warnings.push({
      key: 'SUPABASE_SERVICE_ROLE_KEY',
      message: 'SUPABASE_SERVICE_ROLE_KEY is not set. Server-side Supabase operations may fail.',
    })
  }

  // PAYMENT_PROVIDER is required in production
  if (process.env.NODE_ENV === 'production' && !configured) {
    errors.push({
      key: 'PAYMENT_PROVIDER',
      message: 'PAYMENT_PROVIDER is required in production',
    })
  }

  return { errors, warnings }
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
