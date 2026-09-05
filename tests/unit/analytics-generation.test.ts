// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const tx = vi.hoisted(() => ({
  $executeRaw: vi.fn(),
  analyticsWeeklyInsight: { findUnique: vi.fn(), update: vi.fn() },
  analyticsInsightGenerationAttempt: { findFirst: vi.fn(), count: vi.fn(), create: vi.fn(), updateMany: vi.fn() },
}))
const transaction = vi.hoisted(() => vi.fn())
vi.mock('@/lib/db', () => ({ prisma: { $transaction: transaction } }))

import { claimWeeklyGeneration, finalizeWeeklyGeneration } from '@/server/analytics/weekly-insights/generation'

const now = new Date('2026-09-05T12:00:00.000Z')
const facts = { version: 1 as const, weekStart: '2026-08-24', weekEnd: '2026-08-31', businessTimeZone: 'America/Santiago', sourceConsentVersion: 2 as const, matureCompleteAttempts: 20, visits: 20, conversion: { numerator: 2, denominator: 20, rate: 0.1 }, visitToAttempt: { numerator: 10, denominator: 20, rate: 0.5 }, signals: [], services: [], caveats: ['coverage_complete' as const, 'deterministic_only' as const] }

describe('weekly generation leases', () => {
  beforeEach(() => {
    vi.stubEnv('OWNER_ANALYTICS_INSIGHTS_ENABLED', 'true'); vi.stubEnv('OWNER_ANALYTICS_INSIGHTS_PRIVACY_APPROVED', 'true'); vi.stubEnv('OWNER_ANALYTICS_INSIGHTS_BUSINESS_IDS', 'biz-a'); vi.stubEnv('OWNER_ANALYTICS_INSIGHTS_WEEKLY_CALL_BUDGET', '4'); vi.stubEnv('OWNER_ANALYTICS_INSIGHTS_WEEKLY_TOKEN_BUDGET', '2800')
    transaction.mockImplementation(async (callback: (value: unknown) => unknown) => callback(tx))
    tx.analyticsWeeklyInsight.findUnique.mockResolvedValue({ id: 'weekly-1', businessId: 'biz-a', status: 'deterministic_ready', generationStatus: 'not_requested', facts, inputHash: 'a'.repeat(64), sourceExpiresAt: new Date('2026-11-30T00:00:00Z'), weekStart: new Date('2026-08-24T00:00:00Z') })
    tx.analyticsInsightGenerationAttempt.findFirst.mockResolvedValue(null)
    tx.analyticsInsightGenerationAttempt.count.mockResolvedValue(0)
    tx.analyticsInsightGenerationAttempt.create.mockResolvedValue({ id: 'attempt-1' })
    tx.analyticsWeeklyInsight.update.mockResolvedValue({})
    tx.analyticsInsightGenerationAttempt.updateMany.mockResolvedValue({ count: 1 })
  })
  afterEach(() => { vi.clearAllMocks(); vi.unstubAllEnvs() })

  it('claims once with a 45-second lease and rejects a live duplicate', async () => {
    const claim = await claimWeeklyGeneration({ weeklyInsightId: 'weekly-1', now })
    expect(claim).toMatchObject({ weeklyInsightId: 'weekly-1', attemptId: 'attempt-1', attemptNumber: 1, facts })
    expect(tx.analyticsInsightGenerationAttempt.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'running', leaseExpiresAt: new Date(now.getTime() + 45000) }) }))
    tx.analyticsInsightGenerationAttempt.findFirst.mockResolvedValue({ id: 'attempt-1', attemptNumber: 1, status: 'running', leaseExpiresAt: new Date(now.getTime() + 1000) })
    await expect(claimWeeklyGeneration({ weeklyInsightId: 'weekly-1', now })).resolves.toBeNull()
  })

  it('fences a late result after lease expiry', async () => {
    const claim = await claimWeeklyGeneration({ weeklyInsightId: 'weekly-1', now })
    tx.analyticsInsightGenerationAttempt.updateMany.mockResolvedValue({ count: 0 })
    await finalizeWeeklyGeneration({ claim: claim!, result: { status: 'succeeded', narrative: { summary: 'ok', findings: [], caveats: [] }, providerRequestId: 'resp', outputTokens: 10 }, now: new Date(now.getTime() + 60000) })
    expect(tx.analyticsWeeklyInsight.update).toHaveBeenCalledTimes(1) // claim update only; late result is discarded
  })
})
