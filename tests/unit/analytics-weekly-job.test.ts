// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const config = vi.hoisted(() => vi.fn())
const select = vi.hoisted(() => vi.fn())
const facts = vi.hoisted(() => vi.fn())
const claim = vi.hoisted(() => vi.fn())
const narrate = vi.hoisted(() => vi.fn())
const finalize = vi.hoisted(() => vi.fn())
const queue = vi.hoisted(() => vi.fn())
const evaluate = vi.hoisted(() => vi.fn())
const db = vi.hoisted(() => ({
  analyticsWeeklyInsight: { findUnique: vi.fn(), upsert: vi.fn() },
  analyticsInsightPreference: { findUnique: vi.fn() },
}))

vi.mock('@/lib/analytics/weekly-insights-config', () => ({ getOwnerAnalyticsInsightsConfig: config }))
vi.mock('@/server/analytics/weekly-insights/selector', () => ({ selectWeeklyInsightCandidates: select, encodeWeeklyInsightsCursor: vi.fn(() => 'next') }))
vi.mock('@/server/analytics/weekly-insights/facts', () => ({ buildWeeklyFacts: facts }))
vi.mock('@/server/analytics/weekly-insights/generation', () => ({ claimWeeklyGeneration: claim, finalizeWeeklyGeneration: finalize }))
vi.mock('@/server/analytics/weekly-insights/openai-narrator', () => ({ narrateWeeklyFacts: narrate }))
vi.mock('@/server/analytics/operations/email-outbox', () => ({ queueWeeklyInsightDigest: queue }))
vi.mock('@/server/analytics/operations/incidents', () => ({ evaluateOwnerAnalyticsOperations: evaluate }))
vi.mock('@/lib/db', () => ({ prisma: db }))

import { runWeeklyInsightsJob } from '@/server/analytics/weekly-insights/job'

const now = new Date('2026-09-05T12:00:00.000Z')
const candidate = { businessId: 'biz-a', weekStart: new Date('2026-08-24T00:00:00.000Z'), weekEnd: new Date('2026-08-31T00:00:00.000Z'), businessTimeZone: 'America/Santiago', sourceConsentVersion: 2, sourceExpiresAt: new Date('2026-11-30T00:00:00.000Z') }
const weeklyFacts = { version: 1 as const, weekStart: '2026-08-24', weekEnd: '2026-08-31', businessTimeZone: 'America/Santiago', sourceConsentVersion: 2 as const, matureCompleteAttempts: 20, visits: 20, conversion: { numerator: 2, denominator: 20, rate: 0.1 }, visitToAttempt: { numerator: 10, denominator: 20, rate: 0.5 }, signals: [], services: [], caveats: ['coverage_complete' as const] }

describe('weekly insights side-effect gate', () => {
  beforeEach(() => {
    vi.stubEnv('OWNER_ANALYTICS_OPERATIONAL_MONITOR_ENABLED', 'true')
    vi.stubEnv('OWNER_ANALYTICS_ALERTS_ENABLED', 'false')
    config.mockReturnValue({ enabled: true, model: 'gpt-5.6-luna' })
    select.mockResolvedValue({ candidates: [candidate], nextCursor: null })
    facts.mockResolvedValue({ status: 'deterministic_ready', sourceConsentVersion: 2, facts: weeklyFacts, sourceExpiry: candidate.sourceExpiresAt, inputHash: 'a'.repeat(64) })
    db.analyticsWeeklyInsight.findUnique.mockResolvedValue(null)
    db.analyticsWeeklyInsight.upsert.mockResolvedValue({ id: 'weekly-1' })
    db.analyticsInsightPreference.findUnique.mockResolvedValue({ enabled: true, aiNarrativeEnabled: true, emailEnabled: true, privacyVersion: 2, recipientUserId: 'user-1', recipientUser: { email: 'owner@example.com' } })
    evaluate.mockResolvedValue({ state: 'critical' })
    claim.mockResolvedValue({ facts: weeklyFacts, maxOutputTokens: 700 })
  })
  afterEach(() => { vi.clearAllMocks(); vi.unstubAllEnvs() })

  it('persists deterministic facts but suspends AI and email while operations are unhealthy', async () => {
    await expect(runWeeklyInsightsJob({ now, cursor: null })).resolves.toEqual({ processed: 1, nextCursor: null })
    expect(db.analyticsWeeklyInsight.upsert).toHaveBeenCalled()
    expect(claim).not.toHaveBeenCalled()
    expect(queue).not.toHaveBeenCalled()
  })
})
