// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const tx = vi.hoisted(() => ({
  $executeRaw: vi.fn(),
  analyticsJobHeartbeat: { findUnique: vi.fn(), upsert: vi.fn(), updateMany: vi.fn() },
  analyticsWeeklyInsight: { findUnique: vi.fn(), update: vi.fn() },
  analyticsInsightGenerationAttempt: { findFirst: vi.fn(), count: vi.fn(), findMany: vi.fn(), create: vi.fn(), updateMany: vi.fn() },
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
    tx.analyticsJobHeartbeat.findUnique.mockResolvedValue(null)
    tx.analyticsJobHeartbeat.upsert.mockResolvedValue({ jobKey: 'weekly_insights' })
    tx.analyticsJobHeartbeat.updateMany.mockResolvedValue({ count: 1 })
    tx.analyticsWeeklyInsight.findUnique.mockResolvedValue({ id: 'weekly-1', businessId: 'biz-a', status: 'deterministic_ready', generationStatus: 'not_requested', facts, inputHash: 'a'.repeat(64), sourceExpiresAt: new Date('2026-11-30T00:00:00Z'), weekStart: new Date('2026-08-24T00:00:00Z') })
    tx.analyticsInsightGenerationAttempt.findFirst.mockResolvedValue(null)
    tx.analyticsInsightGenerationAttempt.count.mockResolvedValue(0)
    tx.analyticsInsightGenerationAttempt.findMany.mockResolvedValue([])
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

  it('does not retry a transient provider failure before the one-hour delay', async () => {
    tx.analyticsInsightGenerationAttempt.findFirst.mockResolvedValue({ id: 'attempt-1', attemptNumber: 1, status: 'failed', leaseExpiresAt: null, completedAt: new Date(now.getTime() - 30 * 60 * 1000) })
    await expect(claimWeeklyGeneration({ weeklyInsightId: 'weekly-1', now })).resolves.toBeNull()
    expect(tx.analyticsInsightGenerationAttempt.create).not.toHaveBeenCalled()
  })

  it('allows one retry after the delay but never retries a terminal attempt', async () => {
    tx.analyticsInsightGenerationAttempt.findFirst.mockResolvedValue({ id: 'attempt-1', attemptNumber: 1, status: 'failed', leaseExpiresAt: null, completedAt: new Date(now.getTime() - 60 * 60 * 1000) })
    await expect(claimWeeklyGeneration({ weeklyInsightId: 'weekly-1', now })).resolves.toMatchObject({ attemptNumber: 2 })
    tx.analyticsInsightGenerationAttempt.create.mockClear()
    tx.analyticsInsightGenerationAttempt.findFirst.mockResolvedValue({ id: 'attempt-2', attemptNumber: 2, status: 'manual_review', leaseExpiresAt: null, completedAt: now })
    await expect(claimWeeklyGeneration({ weeklyInsightId: 'weekly-1', now })).resolves.toBeNull()
    expect(tx.analyticsInsightGenerationAttempt.create).not.toHaveBeenCalled()
  })

  it('converts an expired running lease before claiming the bounded retry', async () => {
    tx.analyticsInsightGenerationAttempt.findFirst.mockResolvedValue({ id: 'attempt-1', attemptNumber: 1, status: 'running', leaseExpiresAt: new Date(now.getTime() - 1), completedAt: null })
    await expect(claimWeeklyGeneration({ weeklyInsightId: 'weekly-1', now })).resolves.toMatchObject({ attemptNumber: 2 })
    expect(tx.analyticsInsightGenerationAttempt.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: 'attempt-1', status: 'running' }), data: expect.objectContaining({ status: 'failed', errorCode: 'lease_expired' }) }))
  })

  it('caps the provider output request to the remaining weekly token budget', async () => {
    vi.stubEnv('OWNER_ANALYTICS_INSIGHTS_WEEKLY_TOKEN_BUDGET', '100')
    const claim = await claimWeeklyGeneration({ weeklyInsightId: 'weekly-1', now })
    expect(claim).toMatchObject({ maxOutputTokens: 100 })
  })

  it('blocks claims while the provider circuit is open', async () => {
    tx.analyticsJobHeartbeat.findUnique.mockResolvedValue({ circuitOpenUntil: new Date(now.getTime() + 60 * 60 * 1000), probeLeaseUntil: null })
    await expect(claimWeeklyGeneration({ weeklyInsightId: 'weekly-1', now })).resolves.toBeNull()
    expect(tx.analyticsInsightGenerationAttempt.create).not.toHaveBeenCalled()
  })

  it('opens the circuit after five consecutive failed results', async () => {
    tx.analyticsInsightGenerationAttempt.findMany.mockResolvedValue(Array.from({ length: 5 }, () => ({ status: 'failed' })))
    await finalizeWeeklyGeneration({
      claim: { weeklyInsightId: 'weekly-1', attemptId: 'attempt-1', attemptNumber: 1, leaseToken: '22222222-2222-4222-8222-222222222222', leaseExpiresAt: new Date(now.getTime() + 45000), inputHash: 'a'.repeat(64), facts, maxOutputTokens: 700 },
      result: { status: 'failed', errorCode: 'provider_timeout', retryable: true }, now,
    })
    expect(tx.analyticsJobHeartbeat.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ circuitOpenUntil: expect.any(Date), probeLeaseUntil: null }) }))
  })
})
