import 'server-only'
import { executeUpstashCommand } from '@/lib/upstash-rest'
import { dimensionIdSchema } from './contracts'
import { createHash } from 'node:crypto'
import { ANALYTICS_POLICY } from './policy'

export async function checkAnalyticsRateLimit({ businessId, kind, identity }: { businessId: string; kind: 'bootstrap' | 'batch'; identity: string }): Promise<boolean> {
  const config = getAnalyticsCaptureConfig(businessId)
  if (!config) return false
  const key = createHash('sha256').update(`${businessId}:${identity}`).digest('hex')
  try {
    const result = await executeUpstashCommand({
      restUrl: config.restUrl, restToken: config.restToken, command: 'EVAL',
      args: [`local n = tonumber(redis.call('GET', KEYS[1]) or '0')
if n >= tonumber(ARGV[1]) then return 0 end
local updated = redis.call('INCR', KEYS[1])
if updated == 1 then redis.call('EXPIRE', KEYS[1], ARGV[2]) end
return 1`, 1, `owner-analytics:rate:${kind}:${key}`, kind === 'bootstrap' ? ANALYTICS_POLICY.bootstrapsPerMinute : ANALYTICS_POLICY.batchesPerMinute, 60],
      signal: AbortSignal.timeout(2000),
    })
    return result === 1
  } catch { return false }
}

function positiveInteger(value: string | undefined): number | null {
  if (!value || !/^\d+$/.test(value)) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 && parsed <= 2147483647 ? parsed : null
}

/** Operational attestations are not validation evidence: operators must verify the pilot before setting them. */
export function getAnalyticsCaptureConfig(businessId: string) {
  const env = process.env
  if (env.OWNER_ANALYTICS_ENABLED !== 'true' || env.OWNER_ANALYTICS_PRIVACY_APPROVED !== 'true' || env.OWNER_ANALYTICS_PILOT_APPROVED !== 'true') return null
  if (!dimensionIdSchema.safeParse(businessId).success || !env.OWNER_ANALYTICS_BUSINESS_IDS?.split(',').map((id) => id.trim()).includes(businessId)) return null
  const secret = env.OWNER_ANALYTICS_SECRET ?? ''
  const globalLimit = positiveInteger(env.OWNER_ANALYTICS_GLOBAL_DAILY_BUDGET)
  const tenantLimit = positiveInteger(env.OWNER_ANALYTICS_TENANT_DAILY_BUDGET)
  const verifiedDailyDrain = positiveInteger(env.OWNER_ANALYTICS_VERIFIED_DAILY_DRAIN)
  const restUrl = env.UPSTASH_REDIS_REST_URL
  const restToken = env.UPSTASH_REDIS_REST_TOKEN
  if (Buffer.byteLength(secret) < 32 || !globalLimit || !tenantLimit || !verifiedDailyDrain || tenantLimit > globalLimit || globalLimit >= verifiedDailyDrain || !restUrl || !restToken) return null
  try {
    const url = new URL(restUrl)
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) return null
  } catch { return null }
  return { secret, globalLimit, tenantLimit, restUrl, restToken }
}

// Both keys share one Redis Cluster hash slot. A denied reservation changes neither counter.
const reserveScript = `
local global = tonumber(redis.call('GET', KEYS[1]) or '0')
local tenant = tonumber(redis.call('GET', KEYS[2]) or '0')
local cost = tonumber(ARGV[3])
if global + cost > tonumber(ARGV[1]) or tenant + cost > tonumber(ARGV[2]) then return 0 end
redis.call('INCRBY', KEYS[1], cost)
redis.call('INCRBY', KEYS[2], cost)
redis.call('EXPIRE', KEYS[1], ARGV[4])
redis.call('EXPIRE', KEYS[2], ARGV[4])
return 1
`

export async function reserveAnalyticsBudget({ businessId, cost, now }: { businessId: string; cost: number; now: Date }): Promise<boolean> {
  const config = getAnalyticsCaptureConfig(businessId)
  if (!config || !Number.isSafeInteger(cost) || cost < 1 || cost > config.globalLimit || !Number.isFinite(now.getTime())) return false
  const day = now.toISOString().slice(0, 10)
  try {
    const result = await executeUpstashCommand({
      restUrl: config.restUrl, restToken: config.restToken, command: 'EVAL',
      args: [reserveScript, 2, `owner-analytics:budget:{capture}:${day}:global`, `owner-analytics:budget:{capture}:${day}:tenant:${businessId}`, config.globalLimit, config.tenantLimit, cost, 172800],
      signal: AbortSignal.timeout(2000),
    })
    return result === 1
  } catch { return false }
}
