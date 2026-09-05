import { PrismaClient } from '@prisma/client'
import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { claimWeeklyGeneration } from '@/server/analytics/weekly-insights/generation'

for (const key of ['DATABASE_URL', 'DIRECT_URL'] as const) {
  const raw = process.env[key]
  if (!raw) throw new Error(`${key} must be explicitly set for generation budget integration tests`)
  const url = new URL(raw)
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.pathname !== '/agendita_owner_analytics_test' || process.env.NODE_ENV === 'production') throw new Error('Refusing non-exclusive analytics test database')
}

const prisma = new PrismaClient()
const businessIds: string[] = []
const now = new Date('2026-09-05T12:00:00.000Z')
const facts = { version: 1, weekStart: '2026-08-24', weekEnd: '2026-08-31', businessTimeZone: 'America/Santiago', sourceConsentVersion: 2, matureCompleteAttempts: 20, visits: 20, conversion: { numerator: 2, denominator: 20, rate: 0.1 }, visitToAttempt: { numerator: 10, denominator: 20, rate: 0.5 }, signals: [], services: [], caveats: ['coverage_complete', 'deterministic_only'] }

async function createInsight(businessId: string) {
  return prisma.analyticsWeeklyInsight.create({ data: { businessId, weekStart: new Date('2026-08-24T00:00:00.000Z'), weekEnd: new Date('2026-08-31T00:00:00.000Z'), businessTimeZone: 'America/Santiago', sourceConsentVersion: 2, status: 'deterministic_ready', generationStatus: 'not_requested', facts, inputHash: 'a'.repeat(64), sourceExpiresAt: new Date('2026-11-30T00:00:00.000Z'), retentionExpiresAt: new Date('2026-11-30T00:00:00.000Z') } })
}

beforeEach(() => {
  process.env.OWNER_ANALYTICS_INSIGHTS_ENABLED = 'true'
  process.env.OWNER_ANALYTICS_INSIGHTS_PRIVACY_APPROVED = 'true'
  process.env.OWNER_ANALYTICS_INSIGHTS_BUSINESS_IDS = ''
  process.env.OWNER_ANALYTICS_INSIGHTS_MODEL = 'gpt-5.6-luna'
  process.env.OWNER_ANALYTICS_INSIGHTS_WEEKLY_CALL_BUDGET = '1'
  process.env.OWNER_ANALYTICS_INSIGHTS_WEEKLY_TOKEN_BUDGET = '700'
})
afterEach(async () => {
  if (businessIds.length) await prisma.business.deleteMany({ where: { id: { in: businessIds.splice(0) } } })
  await prisma.analyticsJobHeartbeat.deleteMany({ where: { jobKey: 'weekly_insights' } })
  for (const key of ['OWNER_ANALYTICS_INSIGHTS_ENABLED', 'OWNER_ANALYTICS_INSIGHTS_PRIVACY_APPROVED', 'OWNER_ANALYTICS_INSIGHTS_BUSINESS_IDS', 'OWNER_ANALYTICS_INSIGHTS_MODEL', 'OWNER_ANALYTICS_INSIGHTS_WEEKLY_CALL_BUDGET', 'OWNER_ANALYTICS_INSIGHTS_WEEKLY_TOKEN_BUDGET']) delete process.env[key]
})
afterAll(async () => { await prisma.$disconnect() })

describe('weekly generation budget PostgreSQL boundary', () => {
  it('serializes concurrent claims under one global call budget', async () => {
    const businessA = `generation-a-${randomUUID()}`
    const businessB = `generation-b-${randomUUID()}`
    businessIds.push(businessA, businessB)
    await prisma.business.createMany({ data: [
      { id: businessA, name: 'Generation A', slug: businessA, subdomain: businessA, ownerUserId: 'synthetic-owner', city: 'Santiago' },
      { id: businessB, name: 'Generation B', slug: businessB, subdomain: businessB, ownerUserId: 'synthetic-owner', city: 'Santiago' },
    ] })
    await prisma.analyticsInsightPreference.createMany({ data: [
      { id: randomUUID(), businessId: businessA, enabled: true, aiNarrativeEnabled: true, privacyVersion: 2 },
      { id: randomUUID(), businessId: businessB, enabled: true, aiNarrativeEnabled: true, privacyVersion: 2 },
    ] })
    const [insightA, insightB] = await Promise.all([createInsight(businessA), createInsight(businessB)])
    process.env.OWNER_ANALYTICS_INSIGHTS_BUSINESS_IDS = `${businessA},${businessB}`
    const claims = await Promise.all([
      claimWeeklyGeneration({ weeklyInsightId: insightA.id, now }),
      claimWeeklyGeneration({ weeklyInsightId: insightB.id, now }),
    ])
    expect(claims.filter(Boolean)).toHaveLength(1)
    expect(await prisma.analyticsInsightGenerationAttempt.count()).toBe(1)
  })
})
