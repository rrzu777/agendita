import 'server-only'
import { randomUUID } from 'node:crypto'
import { prisma } from '@/lib/db'
import { getOwnerAnalyticsInsightsConfig } from '@/lib/analytics/weekly-insights-config'
import type { CanonicalWeeklyFacts } from './facts'
import type { NarrativeResult } from './openai-narrator'

const GENERATION_LEASE_MS = 45 * 1000
const MAX_ATTEMPTS = 2

export type GenerationClaim = {
  weeklyInsightId: string
  attemptId: string
  attemptNumber: number
  leaseToken: string
  leaseExpiresAt: Date
  inputHash: string
  facts: CanonicalWeeklyFacts
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
    const insight = await tx.analyticsWeeklyInsight.findUnique({ where: { id: input.weeklyInsightId }, select: { id: true, businessId: true, status: true, generationStatus: true, facts: true, inputHash: true, sourceExpiresAt: true, weekStart: true } })
    if (!insight || insight.sourceExpiresAt <= input.now || !['deterministic_ready', 'generation_failed'].includes(insight.status)) return null
    if (!config.businessIds.includes(insight.businessId)) return null
    const latest = await tx.analyticsInsightGenerationAttempt.findFirst({ where: { weeklyInsightId: insight.id }, orderBy: { attemptNumber: 'desc' }, select: { id: true, attemptNumber: true, status: true, leaseExpiresAt: true } })
    if (latest?.status === 'running' && latest.leaseExpiresAt && latest.leaseExpiresAt > input.now) return null
    const attemptNumber = (latest?.attemptNumber ?? 0) + 1
    if (attemptNumber > MAX_ATTEMPTS) return null
    const periodStart = utcWeekStart(input.now)
    const calls = await tx.analyticsInsightGenerationAttempt.count({ where: { createdAt: { gte: periodStart } } })
    if (calls >= config.weeklyCallBudget) return null
    const attempt = await tx.analyticsInsightGenerationAttempt.create({ data: { weeklyInsightId: insight.id, attemptNumber, status: 'running', leaseToken, leaseExpiresAt, inputHash: insight.inputHash } })
    await tx.analyticsWeeklyInsight.update({ where: { id: insight.id }, data: { status: 'generating', generationStatus: 'running' } })
    return { weeklyInsightId: insight.id, attemptId: attempt.id, attemptNumber, leaseToken, leaseExpiresAt, inputHash: insight.inputHash, facts: insight.facts as unknown as CanonicalWeeklyFacts }
  })
}

export async function finalizeWeeklyGeneration(input: { claim: GenerationClaim; result: NarrativeResult; now: Date }): Promise<void> {
  await prisma.$transaction(async tx => {
    const fenced = await tx.analyticsInsightGenerationAttempt.updateMany({ where: { id: input.claim.attemptId, weeklyInsightId: input.claim.weeklyInsightId, leaseToken: input.claim.leaseToken, status: 'running', leaseExpiresAt: { gt: input.now } }, data: { status: input.result.status === 'succeeded' ? 'succeeded' : input.result.retryable ? 'failed' : 'manual_review', completedAt: input.now, leaseToken: null, leaseExpiresAt: null, ...(input.result.status === 'succeeded' ? { providerRequestId: input.result.providerRequestId, outputTokens: input.result.outputTokens } : { errorCode: input.result.errorCode }) } })
    if (fenced.count !== 1) return
    if (input.result.status === 'succeeded') {
      await tx.analyticsWeeklyInsight.update({ where: { id: input.claim.weeklyInsightId }, data: { status: 'ready', generationStatus: 'succeeded', narrative: input.result.narrative, narrativeGeneratedAt: input.now, reasonCode: null } })
    } else {
      await tx.analyticsWeeklyInsight.update({ where: { id: input.claim.weeklyInsightId }, data: { status: input.result.retryable && input.claim.attemptNumber < MAX_ATTEMPTS ? 'deterministic_ready' : 'generation_failed', generationStatus: input.result.retryable && input.claim.attemptNumber < MAX_ATTEMPTS ? 'failed' : 'manual_review', reasonCode: input.result.errorCode } })
    }
  })
}
