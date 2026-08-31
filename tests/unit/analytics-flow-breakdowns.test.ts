import { describe, expect, it } from 'vitest'
import { reduceFunnelAttempt } from '@/lib/analytics/funnel'
import { aggregateFlowBreakdowns } from '@/lib/analytics/flow-breakdowns'
import { attempt, completePath, contextA, contextB, event, now } from '../helpers/analytics-fixtures'
import type { ObservedEvent } from '@/lib/analytics/report-types'

const paid = { screen: 'cobrar', condition: 'deposit_required', offeredMethods: ['online', 'transfer'] }
const person = { ...contextA, professional: { kind: 'person', professionalId: 'private-professional' } }
const anyone = { ...contextA, professional: { kind: 'anyone' } }
function project(events: ObservedEvent[], entryKind: 'complete' | 'partial' = 'complete', cutoff = now) {
  return reduceFunnelAttempt({ attempt: attempt('private-attempt', entryKind), events, bookings: [], now: cutoff })
}
function chosen() {
  return [event(1, 'funnel_started'), event(2, 'service_selected', { ...person, professionalStepRequired: true }), event(3, 'professional_selected', person), event(4, 'payment_branch_viewed', paid), event(5, 'payment_method_selected', { method: 'online' })]
}

describe('retained current-context flow projection', () => {
  it('records an automatic none and payment preparation without inferring a chosen method', () => {
    expect(project(completePath()).flow).toEqual({ professional: { kind: 'none', choice: 'not_required' }, payment: { screen: 'sin-abono', condition: 'no_deposit', offeredMethods: [], selectedMethod: null }, errors: [] })
    expect(project([event(1, 'payment_branch_viewed', paid)], 'partial').flow.payment?.selectedMethod).toBeNull()
  })
  it.each([person, anyone])('distinguishes an explicit $professional.kind from a required but unobserved choice', context => {
    const events = [event(1, 'service_selected', { ...context, professionalStepRequired: true })]
    expect(project(events, 'partial').flow.professional).toEqual({ kind: context.professional.kind, choice: 'not_observed' })
    expect(project([...events, event(2, 'professional_selected', context)], 'partial').flow.professional).toEqual({ kind: context.professional.kind, choice: 'explicit' })
  })
  it('never treats none as explicit or infers automatic mode from a restored context', () => {
    const events = [event(1, 'selection_context_changed', { reason: 'restore', context: person, localDate: null }), event(2, 'professional_selected', person)]
    expect(project(events, 'partial').flow.professional).toEqual({ kind: 'person', choice: 'not_observed' })
    expect(project([event(1, 'service_selected', { ...contextA, professionalStepRequired: true }), event(2, 'professional_selected', contextA)]).flow.professional).toEqual({ kind: 'none', choice: 'not_observed' })
  })
  it.each(['service', 'modality', 'professional'] as const)('clears stale professional and payment on a %s transition', reason => {
    const context = reason === 'service' ? contextB : reason === 'modality' ? { ...person, modality: 'online' } : anyone
    expect(project([...chosen(), event(6, 'selection_context_changed', { reason, context, localDate: null }, 2)]).flow).toEqual({ professional: { kind: context.professional.kind, choice: 'not_observed' }, payment: null, errors: [] })
  })
  it.each(['date', 'time', 'payment'] as const)('preserves a compatible professional but clears payment on %s change', reason => {
    expect(project([...chosen(), event(6, 'selection_context_changed', { reason, context: person, localDate: '2026-08-10' }, 2)]).flow).toEqual({ professional: { kind: 'person', choice: 'explicit' }, payment: null, errors: [] })
  })
  it('does not let a repeated unchanged snapshot erase an explicit choice', () => {
    expect(project([...chosen(), event(6, 'service_selected', { ...person, professionalStepRequired: true })]).flow.professional).toEqual({ kind: 'person', choice: 'explicit' })
  })
  it('clears dependencies on a lost revision and accepts only newly observed partial payment', () => {
    const p = project([...chosen(), event(6, 'payment_branch_viewed', { screen: 'sin-abono', condition: 'package', offeredMethods: [] }, 3)])
    expect(p.flow).toEqual({ professional: null, payment: { screen: 'sin-abono', condition: 'package', offeredMethods: [], selectedMethod: null }, errors: [] })
    expect(p.quality).toBe('incomplete')
  })
  it.each(['package', 'promotion_zero', 'free_service'] as const)('invalidates a previously selected method for a new %s preparation', condition => {
    expect(project([...chosen(), event(6, 'payment_branch_viewed', { screen: 'sin-abono', condition, offeredMethods: [] }), event(7, 'payment_method_selected', { method: 'online' })]).flow.payment).toEqual({ screen: 'sin-abono', condition, offeredMethods: [], selectedMethod: null })
  })
  it('observes partial payment without inventing pre-consent milestones or professional evidence', () => {
    const p = project([event(1, 'payment_branch_viewed', paid), event(2, 'payment_method_selected', { method: 'transfer' })], 'partial')
    expect(p.flow.payment?.selectedMethod).toBe('transfer')
    expect(p.flow.professional).toBeNull()
    expect(p.maxCoherentMilestones).toEqual([])
    expect(p.converted).toBe(false)
  })
  it('deduplicates errors, ignores old availability generations and retains errors after success', () => {
    const result = (sequence: number, requestGeneration: number, value: string) => event(sequence, 'availability_result', { ...contextA, localDate: '2026-08-10', queryId: crypto.randomUUID(), requestGeneration, result: value })
    const events = [...completePath().slice(0, 4), result(5, 2, 'available'), result(6, 1, 'error'), result(7, 3, 'error'), result(8, 4, 'available'), event(9, 'promotion_result', { result: 'error', category: 'network' }), event(10, 'promotion_result', { result: 'error', category: 'network' }), event(11, 'booking_submit_result', { result: 'rejected' })]
    const p = project([...events].reverse().concat(events[8]))
    expect(p.flow.errors).toEqual(['availability:error', 'promotion:error:network', 'submission:rejected:unknown'])
    expect(project(events.slice(0, 6)).flow.errors).toEqual([])
  })
  it('clears errors on every context transition and ignores asynchronous results from the prior revision', () => {
    const events = [...chosen(), event(6, 'promotion_result', { result: 'rejected', category: 'expired' }), event(7, 'selection_context_changed', { reason: 'payment', context: person, localDate: null }, 2), event(8, 'booking_submit_result', { result: 'error', category: 'network' }), event(9, 'promotion_result', { result: 'accepted', promotionId: 'promo' }, 2)]
    expect(project(events).flow.errors).toEqual([])
  })
  it('clears old errors when an implicit service snapshot changes the context', () => {
    expect(project([...chosen(), event(6, 'promotion_result', { result: 'error', category: 'unknown' }), event(7, 'service_selected', { ...contextB, professionalStepRequired: false })]).flow.errors).toEqual([])
  })
  it('excludes events outside server cutoff and at the exclusive conversion deadline', () => {
    const first = event(1, 'payment_branch_viewed', paid)
    const method = event(2, 'payment_method_selected', { method: 'online' })
    method.receivedAt = new Date('2026-08-02T12:00:00Z')
    expect(project([first, method], 'partial').flow.payment?.selectedMethod).toBeNull()
    expect(project([first], 'partial', new Date('2026-08-01T12:30:00Z')).flow.payment).toBeNull()
    expect(project([first], 'partial', first.receivedAt).flow.payment?.screen).toBe('cobrar')
  })
})

describe('attempt-based flow distributions', () => {
  it('partitions each attempt once by entry and maturity and returns stable closed enum keys only', () => {
    const groups = aggregateFlowBreakdowns([project(completePath()), project(chosen()), project([], 'partial'), project([event(1, 'payment_branch_viewed', paid)], 'partial', new Date('2026-08-01T15:00:00Z'))])
    expect(groups.map(g => [g.entryKind, g.maturity, g.attempts])).toEqual([['complete', 'mature', 2], ['complete', 'in_progress', 0], ['partial', 'mature', 1], ['partial', 'in_progress', 1]])
    expect(groups[0]).toMatchObject({ professional: { 'none:not_required': 1, 'person:explicit': 1 }, selectedMethod: { online: 1, not_observed: 1 }, offeredMethods: { online: 1, transfer: 1, none_offered: 1, not_observed: 0 } })
    expect(groups[2]).toMatchObject({ professional: { not_observed: 1 }, screen: { not_observed: 1 }, offeredMethods: { not_observed: 1 } })
    expect(groups[3]).toMatchObject({ condition: { deposit_required: 1 }, selectedMethod: { not_observed: 1 } })
    const json = JSON.stringify(groups)
    for (const privateValue of ['private-attempt', 'private-professional', 'service-a']) expect(json).not.toContain(privateValue)
  })
  it('counts known capture gaps and errors once per attempt, not once per event', () => {
    const p = project([event(2, 'promotion_result', { result: 'rejected', category: 'invalid' }), event(3, 'promotion_result', { result: 'rejected', category: 'invalid' })])
    expect(aggregateFlowBreakdowns([p])[0]).toMatchObject({ attempts: 1, incompleteCapture: 1, errors: { 'promotion:rejected:invalid': 1 } })
    expect(aggregateFlowBreakdowns([]).map(g => g.attempts)).toEqual([0, 0, 0, 0])
  })
})
