import { executeUpstashCommand } from '@/lib/upstash-rest'

export type DependencyStatus = 'up' | 'down' | 'not_configured' | 'not_required'
export type ConfiguredDependencyStatus = Exclude<DependencyStatus, 'not_required'>

export const DEPENDENCY_TIMEOUT_MS = 3_000

const REDIS_HEALTH_SCRIPT = 'return redis.call("PING")'

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
  if (!restUrl || !restToken) return 'not_configured'

  try {
    const result = await executeUpstashCommand({
      restUrl,
      restToken,
      command: 'EVAL',
      args: [REDIS_HEALTH_SCRIPT, 0],
      signal: timeoutSignal(),
    })
    return result === 'PONG' ? 'up' : 'down'
  } catch {
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
    const response = await fetch('https://api.resend.com/domains', {
      headers: { Authorization: `Bearer ${key}` },
      cache: 'no-store',
      signal: timeoutSignal(),
    })
    if (!response.ok) return 'down'

    const payload: unknown = await response.json()
    return isRecord(payload)
      && payload.object === 'list'
      && Array.isArray(payload.data)
      ? 'up'
      : 'down'
  } catch {
    return 'down'
  }
}

export async function probeMercadoPago(): Promise<DependencyStatus> {
  if (process.env.PAYMENT_PROVIDER !== 'mercado_pago') {
    return 'not_required'
  }

  const token = process.env.MERCADO_PAGO_ACCESS_TOKEN
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
