import 'server-only'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { getOwnerAnalyticsInsightsConfig } from '@/lib/analytics/weekly-insights-config'
import { encodeWeeklyInsightsCursor, selectWeeklyInsightCandidates } from './selector'
import { buildWeeklyFacts } from './facts'
import { claimWeeklyGeneration, finalizeWeeklyGeneration } from './generation'
import { narrateWeeklyFacts } from './openai-narrator'
import { queueWeeklyInsightDigest } from '@/server/analytics/operations/email-outbox'

const JOB_DEADLINE_MS = 40 * 1000
const MIN_REMAINING_MS = 20 * 1000

export async function runWeeklyInsightsJob(input: { now: Date; cursor: string | null }): Promise<{ processed: number; nextCursor: string | null }> {
  const config = getOwnerAnalyticsInsightsConfig()
  if (!config.enabled) return { processed: 0, nextCursor: null }
  const deadline = performance.now() + JOB_DEADLINE_MS
  const selected = await selectWeeklyInsightCandidates({ now: input.now, cursor: input.cursor, limit: 20 })
  let processed = 0
  let lastProcessed = null as (typeof selected.candidates)[number] | null
  for (const candidate of selected.candidates) {
    if (performance.now() + MIN_REMAINING_MS >= deadline) break
    const facts = await buildWeeklyFacts({ businessId: candidate.businessId, weekStart: candidate.weekStart, now: input.now })
    const existing = await prisma.analyticsWeeklyInsight.findUnique({ where: { businessId_weekStart: { businessId: candidate.businessId, weekStart: candidate.weekStart } }, select: { id: true, inputHash: true, status: true } })
    // A published narrative is an immutable snapshot. Late maintenance or a
    // repeated cursor must never erase it or silently replace its evidence.
    const updateData: Prisma.AnalyticsWeeklyInsightUpdateInput = existing?.status === 'ready'
      ? {}
      : {
          sourceConsentVersion: facts.sourceConsentVersion,
          status: facts.status,
          facts: facts.facts ?? { version: 1, reasonCode: facts.reasonCode ?? 'insufficient_data' },
          inputHash: facts.inputHash,
          sourceExpiresAt: facts.sourceExpiry,
          retentionExpiresAt: new Date(Math.min(facts.sourceExpiry.getTime(), candidate.sourceExpiresAt.getTime())),
          reasonCode: facts.reasonCode ?? null,
          ...(facts.status === 'deterministic_ready' ? { generationStatus: 'not_requested' as const, narrative: Prisma.JsonNull, narrativeGeneratedAt: null } : { generationStatus: 'not_requested' as const }),
        }
    const insight = await prisma.analyticsWeeklyInsight.upsert({
      where: { businessId_weekStart: { businessId: candidate.businessId, weekStart: candidate.weekStart } },
      create: { businessId: candidate.businessId, weekStart: candidate.weekStart, weekEnd: candidate.weekEnd, businessTimeZone: candidate.businessTimeZone, sourceConsentVersion: facts.sourceConsentVersion, status: facts.status, generationStatus: 'not_requested', facts: facts.facts ?? { version: 1, reasonCode: facts.reasonCode ?? 'insufficient_data' }, inputHash: facts.inputHash, sourceExpiresAt: facts.sourceExpiry, retentionExpiresAt: new Date(Math.min(facts.sourceExpiry.getTime(), candidate.sourceExpiresAt.getTime())) },
      update: updateData,
      select: { id: true },
    })
    if (facts.status === 'deterministic_ready' && facts.facts && performance.now() + MIN_REMAINING_MS < deadline) {
      const preference = await prisma.analyticsInsightPreference.findUnique({ where: { businessId: candidate.businessId }, select: { aiNarrativeEnabled: true, emailEnabled: true, privacyVersion: true, recipientUserId: true, recipientUser: { select: { email: true } } } })
      if (preference?.aiNarrativeEnabled && preference.privacyVersion === 2) {
        const claim = await claimWeeklyGeneration({ weeklyInsightId: insight.id, now: input.now })
        if (claim) await finalizeWeeklyGeneration({ claim, result: await narrateWeeklyFacts({ facts: claim.facts, model: config.model, now: input.now, maxOutputTokens: claim.maxOutputTokens }), now: input.now })
      }
      if (preference?.emailEnabled && preference.recipientUserId && preference.recipientUser?.email) await queueWeeklyInsightDigest({ weeklyInsightId: insight.id, recipientUserId: preference.recipientUserId, recipientEmail: preference.recipientUser.email, now: input.now })
    }
    processed += 1
    lastProcessed = candidate
  }
  return {
    processed,
    nextCursor: processed < selected.candidates.length
      ? (lastProcessed ? encodeWeeklyInsightsCursor(lastProcessed) : input.cursor)
      : selected.nextCursor,
  }
}
