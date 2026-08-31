import type { AcquisitionSource, AnalyticsEventInput, SelectionContext } from './contracts'

export type EntryKind = 'complete' | 'partial'
export type Population = 'sessions' | 'complete_attempts' | 'partial_attempts'
export type Grain = 'total' | 'channel' | 'acquisition_link' | 'service'
export type Milestone = 'started' | 'service' | 'professional' | 'date' | 'time' | 'customer' | 'payment' | 'submit'
export type CoverageState = 'complete' | 'partial' | 'disabled' | 'unknown'
export type MetricKey = '__publication__' | 'visits' | 'visit_to_attempt' | 'attempts' | 'conversion' | 'bookings_created' | 'conversion_path_complete' | 'conversion_path_incomplete' | 'known_interruption' | 'measurement_incomplete' | 'availability_empty' | 'availability_error' | 'service_interest' | 'service_selected' | 'service_conversion' | 'service_conversion_unobserved' | `milestone:${Milestone}` | `last_step:${'service' | 'professional' | 'date' | 'time' | 'customer' | 'payment' | 'confirmation'}`
export interface CohortIdentity {
  businessId: string
  cohortLocalDate: string
  businessTimeZone: string
  definitionVersion: number
}
export interface SessionFact extends CohortIdentity {
  id: string
  startedAt: Date
  expiresAt: Date
  acquisition: AcquisitionSource
  /** Authoritative attempt start timestamps, not an event-based estimate. */
  attemptStartedAts: Date[]
}
export interface AttemptFact extends CohortIdentity {
  id: string
  sessionId: string
  startedAt: Date
  conversionDeadlineAt: Date
  entryKind: EntryKind
  acquisition: AcquisitionSource
  knownCaptureGap: boolean
}
/** Repository verifies scopes and parses stored data through analyticsEventSchema. */
export interface ObservedEvent { event: AnalyticsEventInput; receivedAt: Date }
export interface BookingFact {
  id: string
  businessId: string
  analyticsAttemptId: string | null
  createdAt: Date
  serviceId: string
  modality: SelectionContext['modality']
  analyticsSelectionRevision: number | null
}
export interface AttemptProjection {
  flow: AttemptFlow
  attempt: AttemptFact
  mature: boolean
  converted: boolean
  bookingsCreated: number
  conversionPathComplete: boolean
  maxCoherentMilestones: Milestone[]
  /** Context that produced the maximum, which may differ from the final selection. */
  maxCoherentContext: SelectionContext | null
  finalContext: SelectionContext | null
  finalRevision: number
  lastObservedStep: string | null
  quality: 'observed' | 'incomplete'
  outcome: 'in_progress' | 'converted' | 'known_interruption' | 'measurement_incomplete'
  consideredServices: string[]
  selectedServices: string[]
  convertedServices: string[]
  convertedServicesWithInterest: string[]
  convertedServicesWithoutInterest: string[]
  availability: { hasValidResult: boolean; hasEmpty: boolean; hasError: boolean; emptyReasons: string[] }
}
type PaymentBranch = Extract<AnalyticsEventInput, { type: 'payment_branch_viewed' }>['data']
export type FlowProfessional = { kind: 'none'; choice: 'not_required' | 'not_observed' } | { kind: 'anyone' | 'person'; choice: 'explicit' | 'not_required' | 'not_observed' }
export type FlowErrorKey = 'availability:error'
  | `promotion:rejected:${'invalid' | 'expired' | 'ineligible' | 'limit_reached' | 'unknown'}`
  | `promotion:error:${'network' | 'unavailable' | 'unknown'}`
  | `submission:${'rejected' | 'error'}:${'validation' | 'slot_unavailable' | 'unauthorized' | 'network' | 'unknown'}`
export interface AttemptFlow {
  professional: FlowProfessional | null
  payment: (PaymentBranch & { selectedMethod: PaymentBranch['offeredMethods'][number] | null }) | null
  errors: FlowErrorKey[]
}
export type FlowProfessionalKey = 'not_observed' | 'none:not_required' | 'none:not_observed' | `${'anyone' | 'person'}:${'explicit' | 'not_required' | 'not_observed'}`
export interface FlowBreakdownGroup {
  entryKind: EntryKind
  maturity: 'mature' | 'in_progress'
  attempts: number
  incompleteCapture: number
  professional: Record<FlowProfessionalKey, number>
  screen: Record<PaymentBranch['screen'] | 'not_observed', number>
  condition: Record<PaymentBranch['condition'] | 'not_observed', number>
  selectedMethod: Record<PaymentBranch['offeredMethods'][number] | 'not_observed', number>
  /** Non-additive: several offered methods can belong to one attempt. */
  offeredMethods: Record<PaymentBranch['offeredMethods'][number] | 'none_offered' | 'not_observed', number>
  /** Non-additive: each error key is counted at most once per attempt. */
  errors: Record<FlowErrorKey, number>
}
export type FlowBreakdownsReport = {
  from: string
  to: string
  cutoffAt: string
  timezones: string[]
  scope: 'all_attempts' | 'channel' | 'acquisition_link' | 'final_service'
} & ({ status: 'available' | 'empty'; groups: FlowBreakdownGroup[] } | { status: 'not_retained' | 'incomplete_source' | 'limit_exceeded' | 'error'; groups: null })
/** One explicit coverage record per business/day/zone/definition, including empty/disabled days. */
export interface CohortCoverage extends CohortIdentity {
  cohortEndAt: Date
  calculatedAt: Date
  cutoffAt: Date
  revision: number
  coverage: CoverageState
  state: 'provisional' | 'closed' | 'failed'
  frozenAt: Date | null
  retentionExpiresAt: Date
}
export interface DailyMetricCell extends CohortIdentity {
  population: Population
  grain: Grain
  dimensionKey: string
  metricKey: MetricKey
  numerator: number
  denominator: number
  revision: number
  state: 'provisional' | 'closed' | 'failed'
  coverage: CoverageState
  calculatedAt: Date
  cutoffAt: Date
  frozenAt: Date | null
  retentionExpiresAt: Date
}
