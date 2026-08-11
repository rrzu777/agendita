import {
  executeUpstashCommand,
  UpstashCommandError,
} from '@/lib/upstash-rest'

export type DependencyStatus = 'up' | 'down' | 'not_configured' | 'not_required'
export type ConfiguredDependencyStatus = Exclude<DependencyStatus, 'not_required'>

export const DEPENDENCY_TIMEOUT_MS = 3_000

const REDIS_HEALTH_SCRIPT = 'return 1'

type RedisHealthFailure =
  | 'partial_configuration'
  | 'timeout_or_network'
  | 'http_status'
  | 'invalid_response'

function logRedisHealthFailure(
  reason: RedisHealthFailure,
  status?: number,
): void {
  console.error(
    '[Health] Redis check failed',
    status === undefined ? { reason } : { reason, status },
  )
}

function timeoutSignal(): AbortSignal {
  return AbortSignal.timeout(DEPENDENCY_TIMEOUT_MS)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function isDependencyReady(
  status: DependencyStatus,
  required: boolean,
): boolean {
  return status === 'up'
    || (!required && (status === 'not_configured' || status === 'not_required'))
}

export async function probeRedis(): Promise<ConfiguredDependencyStatus> {
  const restUrl = process.env.UPSTASH_REDIS_REST_URL
  const restToken = process.env.UPSTASH_REDIS_REST_TOKEN
  if (!restUrl && !restToken) return 'not_configured'
  if (!restUrl || !restToken) {
    logRedisHealthFailure('partial_configuration')
    return 'down'
  }

  try {
    const result = await executeUpstashCommand({
      restUrl,
      restToken,
      command: 'EVAL',
      args: [REDIS_HEALTH_SCRIPT, 0],
      signal: timeoutSignal(),
    })
    if (result === 1) return 'up'
    logRedisHealthFailure('invalid_response')
    return 'down'
  } catch (error) {
    if (error instanceof UpstashCommandError) {
      logRedisHealthFailure(error.reason, error.status)
    } else {
      logRedisHealthFailure('timeout_or_network')
    }
    return 'down'
  }
}

export async function probeSupabase(): Promise<ConfiguredDependencyStatus> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
    ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) return 'not_configured'

  try {
    const response = await fetch(
      `${url.replace(/\/$/, '')}/rest/v1/?limit=1`,
      {
        headers: {
          Authorization: `Bearer ${key}`,
          apikey: key,
        },
        cache: 'no-store',
        signal: timeoutSignal(),
      },
    )
    return response.ok ? 'up' : 'down'
  } catch {
    return 'down'
  }
}

export async function probeResend(): Promise<ConfiguredDependencyStatus> {
  const key = process.env.RESEND_API_KEY
  if (!key) return 'not_configured'

  try {
    // A valid sending_access key reaches payload validation. The empty body is
    // guaranteed not to enqueue an email, while an invalid key fails auth first.
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        'User-Agent': 'agendita-health/1.0',
      },
      body: '{}',
      cache: 'no-store',
      signal: timeoutSignal(),
    })
    if (response.status !== 422) return 'down'

    const payload: unknown = await response.json()
    return isRecord(payload) && payload.name === 'missing_required_field'
      ? 'up'
      : 'down'
  } catch {
    return 'down'
  }
}

export function isMercadoPagoSubscriptionsRequired(): boolean {
  return process.env.MP_SUBSCRIPTIONS_ENABLED?.toLowerCase() === 'true'
}

export function isMercadoPagoOAuthRequired(): boolean {
  return Boolean(
    process.env.MERCADO_PAGO_CLIENT_ID
    || process.env.MERCADO_PAGO_CLIENT_SECRET
    || process.env.MERCADO_PAGO_REDIRECT_URI,
  )
}

export async function probeMercadoPagoSubscriptions(): Promise<DependencyStatus> {
  if (!isMercadoPagoSubscriptionsRequired()) return 'not_required'

  const environment = process.env.MERCADO_PAGO_ENVIRONMENT
  if (environment !== 'sandbox' && environment !== 'production') {
    return 'not_configured'
  }
  const token = process.env[
    `MERCADO_PAGO_${environment.toUpperCase()}_ACCESS_TOKEN`
  ]
  if (!token) return 'not_configured'

  try {
    const response = await fetch('https://api.mercadopago.com/users/me', {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
      signal: timeoutSignal(),
    })
    if (!response.ok) return 'down'

    const payload: unknown = await response.json()
    return isRecord(payload)
      && (typeof payload.id === 'string' || typeof payload.id === 'number')
      ? 'up'
      : 'down'
  } catch {
    return 'down'
  }
}

/**
 * OAuth is multi-tenant: health must never iterate over or expose arbitrary
 * business credentials. This probe therefore validates only application-level
 * configuration. A connected business and a successful E2E charge are separate
 * operational signals documented in the runbook.
 */
export async function probeMercadoPagoOAuth(): Promise<DependencyStatus> {
  if (!isMercadoPagoOAuthRequired()) return 'not_required'

  const clientId = process.env.MERCADO_PAGO_CLIENT_ID
  const clientSecret = process.env.MERCADO_PAGO_CLIENT_SECRET
  const redirectUri = process.env.MERCADO_PAGO_REDIRECT_URI
  if (!clientId || !clientSecret || !redirectUri) return 'down'

  try {
    const url = new URL(redirectUri)
    const localDevelopment = process.env.NODE_ENV !== 'production'
      && url.protocol === 'http:'
      && (url.hostname === 'localhost' || url.hostname === '127.0.0.1')
    return url.protocol === 'https:' || localDevelopment ? 'up' : 'down'
  } catch {
    return 'down'
  }
}
