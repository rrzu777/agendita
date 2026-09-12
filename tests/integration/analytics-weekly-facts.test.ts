import { PrismaClient, type Prisma } from '@prisma/client'
import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildWeeklyFacts } from '@/server/analytics/weekly-insights/facts'

for (const key of ['DATABASE_URL', 'DIRECT_URL'] as const) {
  const raw = process.env[key]
  if (!raw) throw new Error(`${key} must be explicitly set for weekly facts integration tests`)
  const url = new URL(raw)
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.pathname !== '/agendita_owner_analytics_test' || process.env.NODE_ENV === 'production') throw new Error('Refusing non-exclusive analytics test database')
}

const prisma = new PrismaClient()
const createdBusinessIds: string[] = []
const weekStart = new Date('2026-08-24T00:00:00.000Z')

async function createBusiness(prefix: string) {
  const id = `${prefix}-${randomUUID()}`
  createdBusinessIds.push(id)
  await prisma.business.create({ data: { id, name: prefix, slug: id, subdomain: id, ownerUserId: 'synthetic-owner', city: 'Santiago', timezone: 'America/Santiago' } })
  return id
}

async function insertWeek(businessId: string, consentVersion: 1 | 2, denominator = 20, retentionExpiresAt = new Date('2026-11-30T00:00:00.000Z'), missingDay?: number) {
  const rows: Prisma.AnalyticsDailyMetricCreateManyInput[] = []
  for (let day = 0; day < 7; day += 1) {
    if (day === missingDay) continue
    const cohortLocalDate = new Date(weekStart.getTime() + day * 86400000)
    for (const population of ['sessions', 'complete_attempts', 'partial_attempts'] as const) {
      rows.push({ id: randomUUID(), businessId, cohortLocalDate, businessTimeZone: 'America/Santiago', definitionVersion: 1, consentVersion, population, grain: 'total', dimensionKey: 'total', metricKey: '__publication__', numerator: 0, denominator: 0, revision: 1, state: 'closed', coverage: 'complete', calculatedAt: cohortLocalDate, cutoffAt: cohortLocalDate, retentionExpiresAt })
    }
    rows.push({ id: randomUUID(), businessId, cohortLocalDate, businessTimeZone: 'America/Santiago', definitionVersion: 1, consentVersion, population: 'complete_attempts', grain: 'total', dimensionKey: 'total', metricKey: 'conversion', numerator: Math.floor(denominator / 10), denominator, revision: 1, state: 'closed', coverage: 'complete', calculatedAt: cohortLocalDate, cutoffAt: cohortLocalDate, retentionExpiresAt })
    rows.push({ id: randomUUID(), businessId, cohortLocalDate, businessTimeZone: 'America/Santiago', definitionVersion: 1, consentVersion, population: 'sessions', grain: 'total', dimensionKey: 'total', metricKey: 'visits', numerator: denominator * 2, denominator: 0, revision: 1, state: 'closed', coverage: 'complete', calculatedAt: cohortLocalDate, cutoffAt: cohortLocalDate, retentionExpiresAt })
  }
  await prisma.analyticsDailyMetric.createMany({ data: rows })
}

beforeEach(() => {
  process.env.OWNER_ANALYTICS_INSIGHTS_ENABLED = 'false'
})
afterEach(async () => {
  if (createdBusinessIds.length) await prisma.business.deleteMany({ where: { id: { in: createdBusinessIds.splice(0) } } })
  delete process.env.OWNER_ANALYTICS_INSIGHTS_ENABLED
})
afterAll(async () => { await prisma.$disconnect() })

describe('weekly deterministic facts PostgreSQL boundaries', () => {
  it('does not borrow another tenant and preserves source-bounded expiry', async () => {
    const businessA = await createBusiness('weekly-a')
    const businessB = await createBusiness('weekly-b')
    await insertWeek(businessA, 2, 2, new Date('2026-09-30T00:00:00.000Z'))
    await insertWeek(businessB, 2, 20)
    const result = await buildWeeklyFacts({ businessId: businessA, weekStart, now: new Date('2026-09-05T12:00:00.000Z') })
    expect(result.status).toBe('insufficient_data')
    expect(result.reasonCode).toBe('not_enough_mature_attempts')
    expect(result.sourceExpiry.toISOString()).toBe('2026-09-30T00:00:00.000Z')
  })

  it('allows a complete v1 deterministic summary but keeps it source-labelled', async () => {
    const businessId = await createBusiness('weekly-v1')
    await insertWeek(businessId, 1)
    const result = await buildWeeklyFacts({ businessId, weekStart, now: new Date('2026-09-05T12:00:00.000Z') })
    expect(result).toMatchObject({ status: 'deterministic_ready', sourceConsentVersion: 1, facts: { sourceConsentVersion: 1, matureCompleteAttempts: 140 } })
  })

  it('does not turn a missing day into zero history', async () => {
    const businessId = await createBusiness('weekly-gap')
    await insertWeek(businessId, 2, 20, undefined, 3)
    const result = await buildWeeklyFacts({ businessId, weekStart, now: new Date('2026-09-05T12:00:00.000Z') })
    expect(result).toMatchObject({ status: 'insufficient_data', reasonCode: 'incomplete_source', facts: null })
  })
})
