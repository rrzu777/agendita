import 'server-only'
import { randomUUID } from 'node:crypto'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { getOwnerAnalyticsInsightsConfig } from '@/lib/analytics/weekly-insights-config'
import type { CanonicalWeeklyFacts } from './facts'
import type { NarrativeResult } from './openai-narrator'

const GENERATION_LEASE_MS = 45 * 1000
const MAX_ATTEMPTS = 2
const RETRY_DELAY_MS = 60 * 60 * 1000
const CIRCUIT_FAILURE_THRESHOLD = 5
const CIRCUIT_WINDOW_MS = 6 * 60 * 60 * 1000
const CIRCUIT_OPEN_MS = 6 * 60 * 60 * 1000
const CIRCUIT_PROBE_MS = 45 * 1000

export type GenerationClaim = {
  weeklyInsightId: string
  attemptId: string
  attemptNumber: number
  leaseToken: string
  leaseExpiresAt: Date
  inputHash: string
  facts: CanonicalWeeklyFacts
  maxOutputTokens: number
}

async function generationCircuitAllows(tx: Prisma.TransactionClient, now: Date): Promise<boolean> {
  const heartbeat = await tx.analyticsJobHeartbeat.findUnique({ where: { jobKey: 'weekly_insights' }, select: { circuitOpenUntil: true, probeLeaseUntil: true } })
  if (!heartbeat) {
    await tx.analyticsJobHeartbeat.upsert({ where: { jobKey: 'weekly_insights' }, create: { jobKey: 'weekly_insights' }, update: {}, select: { jobKey: true } })
    return true
  }
  if (!heartbeat.circuitOpenUntil) return true
  if (heartbeat.circuitOpenUntil > now) return false
  if (heartbeat.probeLeaseUntil && heartbeat.probeLeaseUntil > now) return false
  const claimed = await tx.analyticsJobHeartbeat.updateMany({
    where: { jobKey: 'weekly_insights', circuitOpenUntil: { lte: now }, OR: [{ probeLeaseUntil: null }, { probeLeaseUntil: { lte: now } }] },
    data: { probeLeaseUntil: new Date(now.getTime() + CIRCUIT_PROBE_MS) },
  })
  return claimed.count === 1
}

async function recordGenerationCircuit(tx: Prisma.TransactionClient, now: Date, succeeded: boolean): Promise<void> {
  if (succeeded) {
    await tx.analyticsJobHeartbeat.updateMany({ where: { jobKey: 'weekly_insights' }, data: { circuitOpenUntil: null, probeLeaseUntil: null } })
    return
  }
  const recent = await tx.analyticsInsightGenerationAttempt.findMany({
    where: { completedAt: { gte: new Date(now.getTime() - CIRCUIT_WINDOW_MS) }, status: { in: ['failed', 'manual_review', 'succeeded'] } },
    orderBy: [{ completedAt: 'desc' }, { id: 'desc' }],
    take: CIRCUIT_FAILURE_THRESHOLD,
    select: { status: true },
  })
  let consecutiveFailures = 0
  for (const row of recent) {
    if (row.status === 'succeeded') break
    consecutiveFailures += 1
  }
  const opened = consecutiveFailures >= CIRCUIT_FAILURE_THRESHOLD
  await tx.analyticsJobHeartbeat.updateMany({
    where: { jobKey: 'weekly_insights' },
    data: { ...(opened ? { circuitOpenUntil: new Date(now.getTime() + CIRCUIT_OPEN_MS) } : {}), probeLeaseUntil: null },
  })
}

function utcWeekStart(now: Date): Date {
  const day = now.getUTCDay()
  const daysSinceMonday = day === 0 ? 6 : day - 1
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - daysSinceMonday))
  return date
}

export async function claimWeeklyGeneration(input: { weeklyInsightId: string; now: Date }): Promise<GenerationClaim | null> {
  const config = getOwnerAnalyticsInsightsConfig()
  if (!config.enabled || !config.privacyApproved) return null
  const leaseExpiresAt = new Date(input.now.getTime() + GENERATION_LEASE_MS)
  const leaseToken = randomUUID()
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('owner-analytics-weekly-generation', 0))`
    if (!await generationCircuitAllows(tx, input.now)) return null
    const insight = await tx.analyticsWeeklyInsight.findUnique({ where: { id: input.weeklyInsightId }, select: { id: true, businessId: true, status: true, generationStatus: true, sourceConsentVersion: true, facts: true, inputHash: true, sourceExpiresAt: true, weekStart: true } })
    if (!insight || insight.sourceExpiresAt <= input.now || insight.sourceConsentVersion !== 2 || (insight.facts as { sourceConsentVersion?: unknown } | null)?.sourceConsentVersion !== 2 || !['deterministic_ready', 'generation_failed'].includes(insight.status)) return null
    if (!config.businessIds.includes(insight.businessId)) return null
    const preference = await tx.analyticsInsightPreference.findUnique({ where: { businessId: insight.businessId }, select: { enabled: true, aiNarrativeEnabled: true, privacyVersion: true } })
    if (!preference?.enabled || !preference.aiNarrativeEnabled || preference.privacyVersion !== 2) return null
    const latest = await tx.analyticsInsightGenerationAttempt.findFirst({ where: { weeklyInsightId: insight.id }, orderBy: { attemptNumber: 'desc' }, select: { id: true, attemptNumber: true, status: true, leaseExpiresAt: true, completedAt: true, nextRetryAt: true } })
    if (latest?.status === 'running' && latest.leaseExpiresAt && latest.leaseExpiresAt > input.now) return null
    if (latest?.status === 'succeeded' || latest?.status === 'manual_review') return null
    if (latest?.status === 'failed' && latest.nextRetryAt && latest.nextRetryAt > input.now) return null
    if (latest?.status === 'failed' && latest.completedAt && input.now.getTime() - latest.completedAt.getTime() < RETRY_DELAY_MS) return null
    if (latest?.status === 'running' && (!latest.leaseExpiresAt || latest.leaseExpiresAt <= input.now)) {
      const terminalLease = latest.attemptNumber >= MAX_ATTEMPTS
      const expired = await tx.analyticsInsightGenerationAttempt.updateMany({
        where: { id: latest.id, status: 'running', leaseExpiresAt: latest.leaseExpiresAt ? { lte: input.now } : undefined },
        data: { status: terminalLease ? 'manual_review' : 'failed', errorCode: 'lease_expired', completedAt: input.now, leaseToken: null, leaseExpiresAt: null, ...(terminalLease ? { nextRetryAt: null } : {}) },
      })
      if (expired.count !== 1) return null
      if (terminalLease) {
        await tx.analyticsWeeklyInsight.update({ where: { id: insight.id }, data: { status: 'generation_failed', generationStatus: 'manual_review', reasonCode: 'lease_expired' } })
        return null
      }
    }
    const attemptNumber = (latest?.attemptNumber ?? 0) + 1
    if (attemptNumber > MAX_ATTEMPTS) return null
    const periodStart = utcWeekStart(input.now)
    const calls = await tx.analyticsInsightGenerationAttempt.count({ where: { createdAt: { gte: periodStart } } })
    if (calls >= config.weeklyCallBudget) return null
    const usage = await tx.analyticsInsightGenerationAttempt.findMany({ where: { createdAt: { gte: periodStart } }, select: { status: true, outputTokens: true } })
    const spentTokens = usage.reduce((sum: number, row: { status: string; outputTokens: number | null }) => sum + (row.status === 'running' ? 0 : row.outputTokens ?? config.maxOutputTokens), 0)
    const reservedTokens = usage.filter((row: { status: string }) => row.status === 'running').length * config.maxOutputTokens
    const remainingTokens = config.weeklyTokenBudget - spentTokens - reservedTokens
    if (remainingTokens <= 0) return null
    const maxOutputTokens = Math.min(config.maxOutputTokens, remainingTokens)
    const attempt = await tx.analyticsInsightGenerationAttempt.create({ data: { weeklyInsightId: insight.id, attemptNumber, status: 'running', leaseToken, leaseExpiresAt, inputHash: insight.inputHash } })
    await tx.analyticsWeeklyInsight.update({ where: { id: insight.id }, data: { status: 'generating', generationStatus: 'running' } })
    return { weeklyInsightId: insight.id, attemptId: attempt.id, attemptNumber, leaseToken, leaseExpiresAt, inputHash: insight.inputHash, facts: insight.facts as unknown as CanonicalWeeklyFacts, maxOutputTokens }
  })
}

export async function finalizeWeeklyGeneration(input: { claim: GenerationClaim; result: NarrativeResult; now: Date }): Promise<void> {
  await prisma.$transaction(async tx => {
    const retryable = input.result.status === 'failed' && input.result.retryable && input.claim.attemptNumber < MAX_ATTEMPTS
    const providerRetryAfterMs = input.result.status === 'failed' ? input.result.retryAfterMs ?? 0 : 0
    const nextRetryAt = retryable ? new Date(input.now.getTime() + Math.max(RETRY_DELAY_MS, providerRetryAfterMs)) : null
    const fenced = await tx.analyticsInsightGenerationAttempt.updateMany({ where: { id: input.claim.attemptId, weeklyInsightId: input.claim.weeklyInsightId, leaseToken: input.claim.leaseToken, status: 'running', leaseExpiresAt: { gt: input.now } }, data: { status: input.result.status === 'succeeded' ? 'succeeded' : input.result.retryable ? 'failed' : 'manual_review', completedAt: input.now, leaseToken: null, leaseExpiresAt: null, nextRetryAt, ...(input.result.status === 'succeeded' ? { providerRequestId: input.result.providerRequestId, outputTokens: input.result.outputTokens } : { errorCode: input.result.errorCode }) } })
    if (fenced.count !== 1) return
    if (input.result.status === 'succeeded') {
      await tx.analyticsWeeklyInsight.update({ where: { id: input.claim.weeklyInsightId }, data: { status: 'ready', generationStatus: 'succeeded', narrative: input.result.narrative, narrativeGeneratedAt: input.now, reasonCode: null } })
      await recordGenerationCircuit(tx, input.now, true)
    } else {
      await tx.analyticsWeeklyInsight.update({ where: { id: input.claim.weeklyInsightId }, data: { status: input.result.retryable && input.claim.attemptNumber < MAX_ATTEMPTS ? 'deterministic_ready' : 'generation_failed', generationStatus: input.result.retryable && input.claim.attemptNumber < MAX_ATTEMPTS ? 'failed' : 'manual_review', reasonCode: input.result.errorCode } })
      await recordGenerationCircuit(tx, input.now, false)
    }
  })
}
