import { ANALYTICS_POLICY as policy } from './policy'
import type { AcquisitionSource } from './contracts'
import type { AttemptProjection, CohortCoverage, CohortIdentity, DailyMetricCell, Grain, MetricKey, Population, SessionFact } from './report-types'

export function ratio(numerator: number, denominator: number): number | null {
  const value = numerator / denominator
  return Number.isFinite(numerator) && Number.isFinite(denominator) && Number.isFinite(value) && numerator >= 0 && denominator > 0 ? value : null
}
/** Registry is shared by reports/rules. Financial or mutable booking statuses do not belong here. */
export const METRIC_DEFINITIONS = {
  visits: { population: 'sessions', unit: 'sessions', source: 'session', windowHours: 24 },
  visit_to_attempt: { population: 'sessions', unit: 'ratio', source: 'attempt', windowHours: 24 },
  attempts: { population: 'attempts_by_entry', unit: 'attempts', source: 'attempt', windowHours: 24 },
  conversion: { population: 'attempts_by_entry', unit: 'ratio', source: 'booking_created_at', windowHours: 24 },
  bookings_created: { population: 'attempts_by_entry', unit: 'bookings', source: 'booking_created_at', windowHours: 24 },
  conversion_path_complete: { population: 'attempts_by_entry', unit: 'attempts', source: 'booking_and_events', windowHours: 24 },
  conversion_path_incomplete: { population: 'attempts_by_entry', unit: 'attempts', source: 'booking_and_events', windowHours: 24 },
  known_interruption: { population: 'attempts_by_entry', unit: 'attempts', source: 'events', windowHours: 24 },
  measurement_incomplete: { population: 'attempts_by_entry', unit: 'attempts', source: 'events', windowHours: 24 },
  availability_empty: { population: 'attempts_by_entry', unit: 'ratio', source: 'events', windowHours: 24 },
  availability_error: { population: 'attempts_by_entry', unit: 'attempts', source: 'events', windowHours: 24 },
  service_interest: { population: 'attempt_service_by_entry', unit: 'attempts', source: 'events', windowHours: 24 },
  service_selected: { population: 'attempt_service_by_entry', unit: 'attempts', source: 'events', windowHours: 24 },
  service_conversion: { population: 'attempt_service_by_entry', unit: 'ratio', source: 'booking_and_events', windowHours: 24 },
  service_conversion_unobserved: { population: 'attempt_service_by_entry', unit: 'attempts', source: 'booking_and_events', windowHours: 24 },
} as const

export interface MetricDefinition {
  key: MetricKey
  definitionVersion: 1
  cohort: 'session_started_at' | 'attempt_started_at'
  grains: readonly Grain[]
  population: string
  unit: string
  source: string
  windowHours: 24
}
export function metricDefinition(key: string): MetricDefinition | null {
  const declared = Object.hasOwn(METRIC_DEFINITIONS, key) ? METRIC_DEFINITIONS[key as keyof typeof METRIC_DEFINITIONS] : null
  const observed = /^(milestone:(started|service|professional|date|time|customer|payment|submit)|last_step:(service|professional|date|time|customer|payment|confirmation))$/.test(key)
  if (!declared && !observed && key !== '__publication__') return null
  const specification = declared ?? { population: 'attempts_by_entry', unit: 'attempts', source: 'events', windowHours: 24 as const }
  return { ...specification, key: key as MetricKey, definitionVersion: 1, cohort: specification.population === 'sessions' ? 'session_started_at' : 'attempt_started_at', grains: key === '__publication__' ? ['total'] : key.startsWith('service_') ? ['service'] : ['total', 'channel', 'acquisition_link'] }
}

function sameCohort(a: CohortIdentity, b: CohortIdentity): boolean {
  return a.businessId === b.businessId && a.cohortLocalDate === b.cohortLocalDate && a.businessTimeZone === b.businessTimeZone && a.definitionVersion === b.definitionVersion
}
function dimensions(acquisition: AcquisitionSource): [Grain, string][] {
  return [['total', 'total'], ['channel', acquisition.channel], ['acquisition_link', acquisition.acquisitionLinkId ?? 'unknown']]
}

export function aggregateDailyMetrics({ sessions, attempts, coverage, definitionVersion }: { sessions: SessionFact[]; attempts: AttemptProjection[]; coverage: CohortCoverage[]; definitionVersion: number }): DailyMetricCell[] {
  if (definitionVersion !== policy.definitionVersion || [...sessions, ...attempts.map((p) => p.attempt), ...coverage].some((row) => row.definitionVersion !== definitionVersion)) throw new Error('Incompatible analytics definition version')
  if ([...sessions, ...attempts.map((p) => p.attempt)].some((row) => !coverage.some((c) => sameCohort(row, c)))) throw new Error('Missing explicit cohort coverage')
  const cells: DailyMetricCell[] = []
  for (const cohort of coverage) {
    const cohortSessions = [...new Map(sessions.filter((s) => sameCohort(s, cohort)).map((s) => [s.id, s])).values()]
    const cohortAttempts = [...new Map(attempts.filter((p) => sameCohort(p.attempt, cohort)).map((p) => [p.attempt.id, p])).values()]
    // Even an empty day must wait until the last possible 24h window plus reconciliation margin.
    const closeAfter = Math.max(cohort.cohortEndAt.getTime() + policy.conversionWindowMs, ...cohortSessions.map((s) => s.expiresAt.getTime()), ...cohortAttempts.map((p) => p.attempt.conversionDeadlineAt.getTime())) + policy.reconciliationMarginMs
    const state = cohort.state === 'failed' ? 'failed' : cohort.state === 'provisional' || cohort.cutoffAt.getTime() < closeAfter || cohortAttempts.some((p) => !p.mature) ? 'provisional' : 'closed'
    const index = new Map<string, DailyMetricCell>()
    function add(population: Population, grain: Grain, dimensionKey: string, metricKey: MetricKey, numerator: number, denominator = 0) {
      const key = JSON.stringify([population, grain, dimensionKey, metricKey])
      let cell = index.get(key)
      if (!cell) {
        cell = { businessId: cohort.businessId, cohortLocalDate: cohort.cohortLocalDate, businessTimeZone: cohort.businessTimeZone, definitionVersion, population, grain, dimensionKey, metricKey, numerator: 0, denominator: 0, revision: cohort.revision, state, coverage: cohort.coverage, calculatedAt: cohort.calculatedAt, cutoffAt: cohort.cutoffAt, frozenAt: cohort.frozenAt, retentionExpiresAt: cohort.retentionExpiresAt }
        index.set(key, cell)
      }
      cell.numerator += numerator; cell.denominator += denominator
      if (!Number.isSafeInteger(cell.numerator) || !Number.isSafeInteger(cell.denominator) || cell.numerator > 2147483647 || cell.denominator > 2147483647) throw new Error('Analytics counter overflow')
    }
    for (const population of ['sessions', 'complete_attempts', 'partial_attempts'] as const) add(population, 'total', 'total', '__publication__', 0)
    if (cohort.coverage !== 'disabled' && cohort.state !== 'failed') {
      for (const s of cohortSessions) for (const [grain, key] of dimensions(s.acquisition)) {
        add('sessions', grain, key, 'visits', 1)
        const mature = s.expiresAt <= cohort.cutoffAt
        add('sessions', grain, key, 'visit_to_attempt', mature && s.attemptStartedAts.some((start) => start >= s.startedAt && start < s.expiresAt) ? 1 : 0, mature ? 1 : 0)
      }
      for (const p of cohortAttempts) {
        const population = p.attempt.entryKind === 'complete' ? 'complete_attempts' : 'partial_attempts'
        for (const [grain, key] of dimensions(p.attempt.acquisition)) {
          add(population, grain, key, 'attempts', 1)
          const mature = p.mature && p.attempt.conversionDeadlineAt <= cohort.cutoffAt
          add(population, grain, key, 'conversion', mature && p.converted ? 1 : 0, mature ? 1 : 0)
          if (!mature) continue
          add(population, grain, key, 'bookings_created', p.bookingsCreated)
          add(population, grain, key, 'conversion_path_complete', p.conversionPathComplete ? 1 : 0, 1)
          add(population, grain, key, 'conversion_path_incomplete', p.converted && !p.conversionPathComplete ? 1 : 0, 1)
          add(population, grain, key, 'known_interruption', p.outcome === 'known_interruption' ? 1 : 0, 1)
          add(population, grain, key, 'measurement_incomplete', p.outcome === 'measurement_incomplete' ? 1 : 0, 1)
          add(population, grain, key, 'availability_empty', p.availability.hasEmpty ? 1 : 0, p.availability.hasValidResult ? 1 : 0)
          add(population, grain, key, 'availability_error', p.availability.hasError ? 1 : 0, 1)
          for (const milestone of p.maxCoherentMilestones) add(population, grain, key, `milestone:${milestone}`, 1)
          if (p.outcome === 'known_interruption' && p.lastObservedStep) add(population, grain, key, `last_step:${p.lastObservedStep}` as MetricKey, 1)
        }
        if (p.mature && p.attempt.conversionDeadlineAt <= cohort.cutoffAt) {
          for (const service of new Set([...p.consideredServices, ...p.selectedServices, ...p.convertedServices])) {
            const interest = p.consideredServices.includes(service)
            add(population, 'service', service, 'service_interest', interest ? 1 : 0)
            add(population, 'service', service, 'service_selected', p.selectedServices.includes(service) ? 1 : 0)
            add(population, 'service', service, 'service_conversion', p.convertedServicesWithInterest.includes(service) ? 1 : 0, interest ? 1 : 0)
            add(population, 'service', service, 'service_conversion_unobserved', p.convertedServicesWithoutInterest.includes(service) ? 1 : 0)
          }
        }
      }
    }
    cells.push(...index.values())
  }
  return cells.sort((a, b) => JSON.stringify([a.businessId, a.cohortLocalDate, a.businessTimeZone, a.population, a.grain, a.dimensionKey, a.metricKey]).localeCompare(JSON.stringify([b.businessId, b.cohortLocalDate, b.businessTimeZone, b.population, b.grain, b.dimensionKey, b.metricKey])))
}
