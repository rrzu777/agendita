// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { analyticsDayRange, summarizeAnalyticsCells, buildAnalyticsOpportunities } from '@/server/analytics/reports'
import { aggregateDailyMetrics } from '@/lib/analytics/daily-metrics'
import { reduceFunnelAttempt } from '@/lib/analytics/funnel'
import { attempt, booking, coverage } from '../helpers/analytics-fixtures'

describe('owner report population and calendar contract', () => {
  it('sums denominators before dividing, separates entry populations and counts two Bookings once', () => {
    const now = new Date('2026-08-04T12:00:00Z')
    const rows = Array.from({ length: 10 }, (_, i) => reduceFunnelAttempt({ attempt: attempt(`a${i}`), events: [], bookings: i < 4 ? [booking(`b${i}`, `a${i}`), ...(i === 0 ? [booking('extra', 'a0')] : [])] : [], now }))
    rows.push(...Array.from({ length: 3 }, (_, i) => reduceFunnelAttempt({ attempt: attempt(`p${i}`, 'partial'), events: [], bookings: i < 2 ? [booking(`pb${i}`, `p${i}`)] : [], now })))
    const report = summarizeAnalyticsCells(aggregateDailyMetrics({ sessions: [], attempts: rows, coverage: [{ ...coverage, cutoffAt: now }], definitionVersion: 1 }))
    expect(report.complete.conversion).toEqual({ numerator: 4, denominator: 10, rate: 0.4 })
    expect(report.partial.conversion).toEqual({ numerator: 2, denominator: 3, rate: 2 / 3 })
    expect(report.complete.bookingsCreated).toBe(5)
  })
  it('does not average daily rates or add channel cells into the total', () => {
    const base = aggregateDailyMetrics({ sessions: [], attempts: [], coverage: [coverage], definitionVersion: 1 })[1]
    const cells = [
      { ...base, population: 'complete_attempts' as const, metricKey: 'conversion' as const, numerator: 1, denominator: 2 },
      { ...base, population: 'complete_attempts' as const, metricKey: 'conversion' as const, cohortLocalDate: '2026-08-02', numerator: 9, denominator: 90 },
      { ...base, population: 'complete_attempts' as const, grain: 'channel' as const, dimensionKey: 'instagram', metricKey: 'conversion' as const, numerator: 10, denominator: 92 },
    ]
    expect(summarizeAnalyticsCells(cells).complete.conversion).toEqual({ numerator: 10, denominator: 92, rate: 10 / 92 })
    expect(summarizeAnalyticsCells([]).complete.conversion.rate).toBeNull()
  })
  it.each([
    ['2026-09-06', '2026-09-06T04:00:00.000Z', '2026-09-07T03:00:00.000Z', '2026-09-08T04:00:00.000Z'],
    ['2026-04-04', '2026-04-04T03:00:00.000Z', '2026-04-05T04:00:00.000Z', '2026-04-06T05:00:00.000Z'],
  ])('partitions DST day %s with an elapsed 25h reconciliation after its true end', (day, start, end, close) => {
    const range = analyticsDayRange(day, 'America/Santiago')
    expect(range.start.toISOString()).toBe(start)
    expect(range.end.toISOString()).toBe(end)
    expect(range.closeAfter.toISOString()).toBe(close)
  })
  it('requires all three availability thresholds and keeps demonstrated reasons and conversions distinct', () => {
    for (const [numerator, denominator] of [[6, 19], [4, 20], [5, 20]]) expect(buildAnalyticsOpportunities({ numerator, denominator, rate: numerator / denominator }, null, 0)).toEqual([])
    const result = buildAnalyticsOpportunities({ numerator: 6, denominator: 20, rate: 0.3 }, { eligible: 20, affected: 6, converted: 2, reasons: { outside_window: 4, unknown: 2 } }, 1)
    expect(result).toHaveLength(2)
    expect(result[0]).toMatchObject({ key: 'availability_empty', numerator: 6, denominator: 20, diagnostics: { status: 'available', converted: 2, reasons: { outside_window: 4, unknown: 2 } } })
    expect(result[1]).toMatchObject({ key: 'overdue_approval', denominator: null })
  })
})
