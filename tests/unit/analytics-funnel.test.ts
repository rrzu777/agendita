import { describe, expect, it } from 'vitest'
import { reduceFunnelAttempt } from '@/lib/analytics/funnel'
import { attempt, booking, completePath, contextA, contextB, event, now } from '../helpers/analytics-fixtures'

describe('coherent observed funnel and authoritative conversion', () => {
  it('fixture 4: thirty events and two bookings mean one conversion and two bookings', () => {
    const events = [...completePath(), event(9, 'service_considered', { serviceId: 'service-b' }), event(10, 'service_considered', { serviceId: 'service-c' }), event(11, 'service_considered', { serviceId: 'service-a' }), ...Array.from({ length: 19 }, (_, i) => event(i + 12, 'step_viewed', { step: 'confirmation' }))]
    const result = reduceFunnelAttempt({ attempt: attempt(), events: events.reverse(), bookings: [booking(), booking('booking-2')], now })
    expect(result).toMatchObject({ converted: true, bookingsCreated: 2, conversionPathComplete: true, consideredServices: ['service-a', 'service-b', 'service-c'] })
    expect(result.maxCoherentMilestones).not.toContain('professional')
  })
  it('fixture 5: authoritative booking without interest keeps overall conversion only', () => {
    expect(reduceFunnelAttempt({ attempt: attempt(), events: [], bookings: [booking()], now })).toMatchObject({ converted: true, conversionPathComplete: false, consideredServices: [], convertedServicesWithInterest: [], convertedServicesWithoutInterest: ['service-a'] })
  })
  it('fixture 6: time A cannot complete submission B, nor cause abandonment A', () => {
    const events = [...completePath().slice(0, 5), event(6, 'selection_context_changed', { reason: 'service', context: contextB, localDate: null }, 2), event(7, 'service_considered', { serviceId: 'service-b' }, 2), event(8, 'service_selected', { ...contextB, professionalStepRequired: false }, 2), event(9, 'date_selected', { ...contextB, localDate: '2026-08-10' }, 2), event(11, 'customer_step_completed', {}, 2), event(12, 'booking_submit_result', { result: 'submitted' }, 2)]
    const result = reduceFunnelAttempt({ attempt: attempt(), events, bookings: [{ ...booking('b', 'attempt-1', 'service-b'), analyticsSelectionRevision: 2 }], now })
    expect(result).toMatchObject({ converted: true, conversionPathComplete: false, outcome: 'converted', quality: 'incomplete', finalContext: contextB, consideredServices: ['service-a', 'service-b'] })
    expect(result.maxCoherentMilestones).toEqual(['started', 'service', 'date', 'time'])
    expect(result.maxCoherentContext).toEqual(contextA)
  })
  it('uses createdAt including the lower bound, excluding deadline and other tenants', () => {
    const a = attempt()
    const bookings = [{ ...booking(), createdAt: a.startedAt }, { ...booking('deadline'), createdAt: a.conversionDeadlineAt }, { ...booking('early'), createdAt: new Date(a.startedAt.getTime() - 1) }, { ...booking('other'), businessId: 'other' }]
    expect(reduceFunnelAttempt({ attempt: a, events: [], bookings, now }).bookingsCreated).toBe(1)
    expect(reduceFunnelAttempt({ attempt: a, events: [], bookings, now: new Date('2026-08-02T11:00:00Z') }).outcome).toBe('in_progress')
  })
  it('preserves compatible upstream milestones across revision changes', () => {
    const events = [...completePath().slice(0, 5), event(6, 'selection_context_changed', { reason: 'date', context: contextA, localDate: '2026-08-11' }, 2), event(7, 'date_selected', { ...contextA, localDate: '2026-08-11' }, 2), event(8, 'time_selected', { ...contextA, localDate: '2026-08-11', timeBucket: '18_24' }, 2), event(9, 'customer_step_completed', {}, 2), event(10, 'payment_branch_viewed', { screen: 'sin-abono', condition: 'no_deposit', offeredMethods: [] }, 2), event(11, 'booking_submit_result', { result: 'submitted' }, 2)]
    expect(reduceFunnelAttempt({ attempt: attempt(), events, bookings: [{ ...booking(), analyticsSelectionRevision: 2 }], now }).conversionPathComplete).toBe(true)
  })
  it('does not invent professional choice or accept late evidence', () => {
    const events = completePath()
    events[2] = event(3, 'service_selected', { ...contextA, professionalStepRequired: true })
    expect(reduceFunnelAttempt({ attempt: attempt(), events, bookings: [booking()], now }).conversionPathComplete).toBe(false)
    const late = completePath().map((e) => ({ ...e, receivedAt: attempt().conversionDeadlineAt }))
    expect(reduceFunnelAttempt({ attempt: attempt(), events: late, bookings: [booking()], now }).conversionPathComplete).toBe(false)
  })
  it('counts only the latest availability generation of a current context, errors separately', () => {
    const query = '59f1ff5d-bf6f-4b96-b6e0-1be52096731a'
    const data = { ...contextA, localDate: '2026-08-10', queryId: query }
    const events = [...completePath().slice(0, 4), event(5, 'availability_result', { ...data, requestGeneration: 2, result: 'available' }), event(6, 'availability_result', { ...data, requestGeneration: 1, result: 'empty', reason: 'no_capacity' }), event(7, 'availability_result', { ...data, requestGeneration: 3, result: 'error' })]
    expect(reduceFunnelAttempt({ attempt: attempt(), events, bookings: [], now }).availability).toEqual({ hasValidResult: true, hasEmpty: false, hasError: true, emptyReasons: [] })
  })
  it('does not count cloned/replayed events or assign known capture gaps to a dropoff', () => {
    const path = completePath().slice(0, 5)
    expect(reduceFunnelAttempt({ attempt: attempt(), events: [...path, path[0]], bookings: [], now }).outcome).toBe('known_interruption')
    expect(reduceFunnelAttempt({ attempt: { ...attempt(), knownCaptureGap: true }, events: path, bookings: [], now }).outcome).toBe('measurement_incomplete')
  })
  it('does not stitch downstream evidence seen before its prerequisite', () => {
    const events = [...completePath().slice(0, 5), event(6, 'payment_branch_viewed', { screen: 'sin-abono', condition: 'no_deposit', offeredMethods: [] }), event(7, 'customer_step_completed'), event(8, 'booking_submit_result', { result: 'submitted' })]
    expect(reduceFunnelAttempt({ attempt: attempt(), events, bookings: [booking()], now }).conversionPathComplete).toBe(false)
  })
  it('professional changes retain an explicitly observed date but require a fresh time', () => {
    const person = { ...contextA, professional: { kind: 'person', professionalId: 'person-a' } }
    const anyone = { ...contextA, professional: { kind: 'anyone' } }
    const events = [event(1, 'funnel_started'), event(2, 'service_selected', { ...contextA, professionalStepRequired: true }), event(3, 'professional_selected', person), event(4, 'date_selected', { ...person, localDate: '2026-08-10' }), event(5, 'selection_context_changed', { reason: 'professional', context: anyone, localDate: '2026-08-10' }, 2), event(6, 'professional_selected', anyone, 2), event(7, 'time_selected', { ...anyone, localDate: '2026-08-10', timeBucket: '12_18' }, 2), event(8, 'customer_step_completed', {}, 2), event(9, 'payment_branch_viewed', { screen: 'sin-abono', condition: 'no_deposit', offeredMethods: [] }, 2), event(10, 'booking_submit_result', { result: 'submitted' }, 2)]
    expect(reduceFunnelAttempt({ attempt: attempt(), events, bookings: [{ ...booking(), analyticsSelectionRevision: 2 }], now }).conversionPathComplete).toBe(true)
  })
  it('does not call a deliberately partial entry a known capture gap merely for missing pre-consent steps', () => {
    const events = [event(1, 'step_viewed', { step: 'customer' }), event(2, 'customer_step_completed'), event(3, 'payment_branch_viewed', { screen: 'sin-abono', condition: 'no_deposit', offeredMethods: [] })]
    expect(reduceFunnelAttempt({ attempt: attempt('partial-1', 'partial'), events, bookings: [], now })).toMatchObject({ quality: 'observed', outcome: 'known_interruption', lastObservedStep: 'payment', conversionPathComplete: false })
  })
})
