// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const findMany = vi.hoisted(() => vi.fn())
vi.mock('@/lib/db', () => ({ prisma: { analyticsDailyMetric: { findMany } } }))

import { buildWeeklyFacts } from '@/server/analytics/weekly-insights/facts'

const weekStart = new Date('2026-08-24T00:00:00.000Z')
const expiry = new Date('2026-11-30T00:00:00.000Z')
function row(day: number, overrides: Record<string, unknown> = {}) {
  return { id: `${day}-${String(Object.keys(overrides).join('-'))}`, businessId: 'biz-a', cohortLocalDate: new Date(weekStart.getTime() + day * 86400000), businessTimeZone: 'America/Santiago', definitionVersion: 1, consentVersion: 2, population: 'complete_attempts', grain: 'total', dimensionKey: 'total', metricKey: 'conversion', numerator: 2, denominator: 20, revision: 1, state: 'closed', coverage: 'complete', calculatedAt: weekStart, cutoffAt: weekStart, frozenAt: weekStart, retentionExpiresAt: expiry, ...overrides }
}
function completeWeek() {
  const rows: Record<string, unknown>[] = []
  for (let day = 0; day < 7; day += 1) {
    rows.push(row(day, { id: `pub-s-${day}`, population: 'sessions', metricKey: '__publication__', numerator: 0, denominator: 0 }))
    rows.push(row(day, { id: `pub-c-${day}`, population: 'complete_attempts', metricKey: '__publication__', numerator: 0, denominator: 0 }))
    rows.push(row(day, { id: `pub-p-${day}`, population: 'partial_attempts', metricKey: '__publication__', numerator: 0, denominator: 0 }))
    rows.push(row(day, { id: `attempts-${day}`, metricKey: 'attempts', numerator: 20, denominator: 0 }))
    rows.push(row(day, { id: `conversion-${day}`, metricKey: 'conversion', numerator: 2, denominator: 20 }))
    rows.push(row(day, { id: `visits-${day}`, population: 'sessions', metricKey: 'visits', numerator: 50, denominator: 0 }))
    rows.push(row(day, { id: `visit-attempt-${day}`, population: 'sessions', metricKey: 'visit_to_attempt', numerator: 20, denominator: 50 }))
    rows.push(row(day, { id: `empty-${day}`, metricKey: 'availability_empty', numerator: 10, denominator: 20 }))
  }
  return rows
}

describe('weekly deterministic facts', () => {
  beforeEach(() => {
    vi.stubEnv('OWNER_ANALYTICS_INSIGHTS_ENABLED', 'false')
    findMany.mockResolvedValue(completeWeek())
  })
  afterEach(() => { vi.clearAllMocks(); vi.unstubAllEnvs() })

  it('keeps exact denominators and emits bounded canonical signals', async () => {
    const result = await buildWeeklyFacts({ businessId: 'biz-a', weekStart, now: new Date('2026-09-05T12:00:00.000Z') })
    expect(result.status).toBe('deterministic_ready')
    expect(result.sourceConsentVersion).toBe(2)
    expect(result.facts?.matureCompleteAttempts).toBe(140)
    expect(result.facts?.conversion).toMatchObject({ numerator: 14, denominator: 140 })
    expect(result.facts?.signals.map(signal => signal.factId)).toEqual(['conversion_below_15_percent', 'availability_empty_over_30_percent'])
    expect(result.facts?.signals.length).toBeLessThanOrEqual(3)
  })

  it('does not turn missing history into zeros', async () => {
    findMany.mockResolvedValue(completeWeek().filter(row => (row.cohortLocalDate as Date).getUTCDate() !== 24))
    const result = await buildWeeklyFacts({ businessId: 'biz-a', weekStart, now: new Date('2026-09-05T12:00:00.000Z') })
    expect(result.status).toBe('insufficient_data')
    expect(result.reasonCode).toBe('incomplete_source')
    expect(result.facts).toBeNull()
  })
})
