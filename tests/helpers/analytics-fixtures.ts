import { analyticsEventSchema, type AnalyticsEventInput } from '@/lib/analytics/contracts'
import type { AttemptFact, BookingFact, CohortCoverage, ObservedEvent } from '@/lib/analytics/report-types'

export const now = new Date('2026-08-03T03:00:00.000Z')
export const contextA = { serviceId: 'service-a', modality: 'on_site', professional: { kind: 'none' } }
export const contextB = { ...contextA, serviceId: 'service-b' }
export function attempt(id = 'attempt-1', entryKind: 'complete' | 'partial' = 'complete'): AttemptFact {
  return { id, businessId: 'business-a', sessionId: 'session-a', startedAt: new Date('2026-08-01T12:00:00Z'), conversionDeadlineAt: new Date('2026-08-02T12:00:00Z'), cohortLocalDate: '2026-08-01', businessTimeZone: 'America/Santiago', definitionVersion: 1, entryKind, acquisition: { channel: 'instagram', normalizationVersion: 1, acquisitionLinkId: null }, knownCaptureGap: false }
}
export function event(sequence: number, type: AnalyticsEventInput['type'], data: unknown = {}, selectionRevision = 1): ObservedEvent {
  return { receivedAt: new Date('2026-08-01T13:00:00Z'), event: analyticsEventSchema.parse({ version: 1, eventId: `59f1ff5d-bf6f-4b96-b6e0-${sequence.toString().padStart(12, '0')}`, sequence, type, ...(!['public_profile_viewed', 'booking_entry_viewed'].includes(type) ? { selectionRevision } : {}), data }) }
}
export function completePath(): ObservedEvent[] {
  return [event(1, 'funnel_started'), event(2, 'service_considered', { serviceId: 'service-a' }), event(3, 'service_selected', { ...contextA, professionalStepRequired: false }), event(4, 'date_selected', { ...contextA, localDate: '2026-08-10' }), event(5, 'time_selected', { ...contextA, localDate: '2026-08-10', timeBucket: '12_18' }), event(6, 'customer_step_completed'), event(7, 'payment_branch_viewed', { screen: 'sin-abono', condition: 'no_deposit', offeredMethods: [] }), event(8, 'booking_submit_result', { result: 'submitted' })]
}
export function booking(id = 'booking-1', attemptId = 'attempt-1', serviceId = 'service-a'): BookingFact {
  return { id, businessId: 'business-a', analyticsAttemptId: attemptId, createdAt: new Date('2026-08-01T14:00:00Z'), serviceId, modality: 'on_site', analyticsSelectionRevision: 1 }
}
export const coverage: CohortCoverage = { businessId: 'business-a', cohortLocalDate: '2026-08-01', businessTimeZone: 'America/Santiago', definitionVersion: 1, cohortEndAt: new Date('2026-08-02T04:00:00Z'), calculatedAt: now, cutoffAt: now, revision: 1, state: 'closed', coverage: 'complete', frozenAt: null, retentionExpiresAt: new Date('2026-10-30T04:00:00Z') }
