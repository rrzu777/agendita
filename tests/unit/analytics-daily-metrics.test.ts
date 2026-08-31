import { describe, expect, it } from 'vitest'
import { aggregateDailyMetrics, metricDefinition, ratio } from '@/lib/analytics/daily-metrics'
import { reduceFunnelAttempt } from '@/lib/analytics/funnel'
import { attempt, booking, completePath, coverage, now } from '../helpers/analytics-fixtures'
import type { AttemptProjection } from '@/lib/analytics/report-types'

function fixtures(): AttemptProjection[] {
  // Fixtures 1/2: 10 complete = 4 converted (3 coherent), 4 last observed, 2 known gaps.
  const complete = Array.from({ length: 10 }, (_, i) => reduceFunnelAttempt({ attempt: { ...attempt(`a${i}`), knownCaptureGap: i >= 8 }, events: i === 3 ? [] : completePath().slice(0, i < 3 ? 8 : 5), bookings: i < 4 ? [booking(`b${i}`, `a${i}`)] : [], now }))
  const partial = Array.from({ length: 3 }, (_, i) => reduceFunnelAttempt({ attempt: attempt(`p${i}`, 'partial'), events: [], bookings: i < 2 ? [booking(`pb${i}`, `p${i}`)] : [], now }))
  return [...complete, ...partial]
}
describe('daily counters preserve populations and closed cohorts', () => {
  it('fixtures 1/2: keeps 4/10 separate from 2/3 and partitions complete outcomes 4+4+2', () => {
    const cells = aggregateDailyMetrics({ sessions: [], attempts: fixtures(), coverage: [coverage], definitionVersion: 1 })
    const value = (metricKey: string, population = 'complete_attempts') => cells.find((c) => c.metricKey === metricKey && c.population === population && c.grain === 'total')
    expect(value('conversion')).toMatchObject({ numerator: 4, denominator: 10 })
    expect(value('conversion', 'partial_attempts')).toMatchObject({ numerator: 2, denominator: 3 })
    expect(value('conversion_path_complete')).toMatchObject({ numerator: 3, denominator: 10 })
    expect(value('known_interruption')).toMatchObject({ numerator: 4, denominator: 10 })
    expect(value('measurement_incomplete')).toMatchObject({ numerator: 2, denominator: 10 })
  })
  it('fixture 3: divides summed counts, not an average of daily percentages', () => {
    expect(ratio(4, 10)).toBe(0.4)
    expect(ratio(1, 0)).toBeNull()
    expect(ratio(1 + 9, 2 + 90)).toBeCloseTo(0.10869565217391304)
    expect(ratio(NaN, 4)).toBeNull()
    expect(ratio(Number.MAX_VALUE, Number.MIN_VALUE)).toBeNull()
  })
  it('fixture 5: keeps unobserved service conversion outside interest numerator', () => {
    const p = reduceFunnelAttempt({ attempt: attempt(), events: [], bookings: [booking()], now })
    const cells = aggregateDailyMetrics({ sessions: [], attempts: [p], coverage: [coverage], definitionVersion: 1 })
    expect(cells.find((c) => c.metricKey === 'service_conversion' && c.dimensionKey === 'service-a')).toMatchObject({ numerator: 0, denominator: 0 })
    expect(cells.find((c) => c.metricKey === 'service_conversion_unobserved' && c.dimensionKey === 'service-a')).toMatchObject({ numerator: 1 })
  })
  it('publishes explicit markers for empty and disabled cohorts without inventing observed zeros', () => {
    const cells = aggregateDailyMetrics({ sessions: [], attempts: [], coverage: [{ ...coverage, coverage: 'disabled' }], definitionVersion: 1 })
    expect(cells).toHaveLength(3)
    expect(cells.every((c) => c.metricKey === '__publication__' && c.coverage === 'disabled')).toBe(true)
  })
  it('keeps open windows provisional and rejects silently mixed definition versions', () => {
    const p = reduceFunnelAttempt({ attempt: attempt(), events: [], bookings: [], now: new Date('2026-08-01T20:00:00Z') })
    const cells = aggregateDailyMetrics({ sessions: [], attempts: [p], coverage: [{ ...coverage, cutoffAt: new Date('2026-08-01T20:00:00Z') }], definitionVersion: 1 })
    expect(cells.every((c) => c.state === 'provisional')).toBe(true)
    expect(() => aggregateDailyMetrics({ sessions: [], attempts: [p], coverage: [{ ...coverage, definitionVersion: 2 }], definitionVersion: 1 })).toThrow()
  })
  it('registry makes cohort, version and allowed grains explicit and excludes financial/current statuses', () => {
    expect(metricDefinition('service_conversion')).toMatchObject({ definitionVersion: 1, cohort: 'attempt_started_at', grains: ['service'], unit: 'ratio', source: 'booking_and_events' })
    expect(metricDefinition('milestone:time')).toMatchObject({ definitionVersion: 1, cohort: 'attempt_started_at', grains: ['total', 'channel', 'acquisition_link'] })
    expect(metricDefinition('paid')).toBeNull()
  })
  it('session-to-start uses the session cohort, and full closed publication waits for one-hour reconciliation', () => {
    const cutoffAt = new Date('2026-08-03T05:00:00Z')
    const session = { ...attempt(), expiresAt: new Date('2026-08-02T12:00:00Z'), attemptStartedAts: [new Date('2026-08-02T11:00:00Z'), new Date('2026-08-02T12:00:00Z')] }
    const cells = aggregateDailyMetrics({ sessions: [session], attempts: [], coverage: [{ ...coverage, cutoffAt, calculatedAt: cutoffAt }], definitionVersion: 1 })
    expect(cells.find((c) => c.metricKey === 'visit_to_attempt' && c.grain === 'total')).toMatchObject({ numerator: 1, denominator: 1, state: 'closed' })
  })
})
