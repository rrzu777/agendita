import type { SelectionContext } from './contracts'
import type { AttemptFact, AttemptProjection, BookingFact, Milestone, ObservedEvent } from './report-types'

const order: Milestone[] = ['started', 'service', 'professional', 'date', 'time', 'customer', 'payment', 'submit']
function sameService(a: SelectionContext | null, b: SelectionContext | null): boolean {
  return !!a && !!b && a.serviceId === b.serviceId && a.modality === b.modality
}
function sameContext(a: SelectionContext | null, b: SelectionContext | null): boolean {
  return sameService(a, b) && JSON.stringify(a!.professional) === JSON.stringify(b!.professional)
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`
  return JSON.stringify(value)
}

/** Pure definition-v1 reducer. receivedAt is server time; client payload is already schema-validated. */
export function reduceFunnelAttempt({ attempt, events, bookings, now }: { attempt: AttemptFact; events: ObservedEvent[]; bookings: BookingFact[]; now: Date }): AttemptProjection {
  let context: SelectionContext | null = null
  let localDate: string | null = null
  let timeBucket: string | null = null
  let requiredProfessional = false
  let revision = 1
  let gap = attempt.knownCaptureGap
  let lastObservedStep: string | null = null
  let paymentKey: string | null = null
  let offeredMethods: string[] = []
  let selectedMethod: string | null = null
  const evidence = new Set<Milestone>()
  let maxCoherentMilestones: Milestone[] = []
  let maxCoherentContext: SelectionContext | null = null
  const considered = new Set<string>()
  const selected = new Set<string>()
  const submissions: { revision: number; context: SelectionContext; complete: boolean }[] = []
  const generations = new Map<string, number>()
  const availability = { hasValidResult: false, hasEmpty: false, hasError: false, emptyReasons: [] as string[] }
  const seenIds = new Map<string, string>()
  const seenSequences = new Map<number, string>()
  let lastSequence = 0

  function invalidate(from: Milestone) {
    for (const milestone of order.slice(order.indexOf(from))) evidence.delete(milestone)
    if (order.indexOf(from) <= order.indexOf('time')) timeBucket = null
    if (order.indexOf(from) <= order.indexOf('payment')) { paymentKey = null; offeredMethods = []; selectedMethod = null }
  }
  function prefix(): Milestone[] {
    const result: Milestone[] = []
    for (const milestone of order) {
      if (milestone === 'professional' && !requiredProfessional) continue
      if (!evidence.has(milestone)) break
      result.push(milestone)
    }
    return result
  }
  function mark(milestone: Milestone) {
    const prerequisites = order.slice(0, order.indexOf(milestone)).filter((key) => key !== 'professional' || requiredProfessional)
    if (prerequisites.some((key) => !evidence.has(key))) {
      // An intentional partial entry never claims pre-consent evidence existed.
      if (attempt.entryKind === 'complete') gap = true
      return
    }
    evidence.add(milestone)
    const coherent = prefix()
    if (!coherent.includes(milestone)) gap = true
    if (order.indexOf(coherent.at(-1)!) > order.indexOf(maxCoherentMilestones.at(-1)!)) {
      maxCoherentMilestones = coherent
      maxCoherentContext = context
    }
  }
  function compatible(next: SelectionContext): boolean {
    if (sameContext(context, next)) return true
    gap = true
    return false
  }

  for (const observed of [...events].sort((a, b) => a.event.sequence - b.event.sequence || a.event.eventId.localeCompare(b.event.eventId))) {
    if (observed.receivedAt < attempt.startedAt || observed.receivedAt >= attempt.conversionDeadlineAt || observed.receivedAt > now) continue
    const event = observed.event
    const fingerprint = canonical(event)
    if (seenIds.has(event.eventId)) { if (seenIds.get(event.eventId) !== fingerprint) gap = true; continue }
    if (seenSequences.has(event.sequence)) { gap = true; continue }
    seenIds.set(event.eventId, fingerprint)
    seenSequences.set(event.sequence, event.eventId)
    if (event.sequence !== lastSequence + 1) gap = true
    lastSequence = event.sequence
    if (!('selectionRevision' in event)) continue
    if (event.selectionRevision < revision) continue
    if (event.selectionRevision > revision) {
      // A repeated service snapshot cannot explain which upstream selection changed.
      // Only the observed transition can justify preserving compatible old milestones.
      if (event.type !== 'selection_context_changed') { gap = true; invalidate('service'); context = null; localDate = null }
      revision = event.selectionRevision
    }
    switch (event.type) {
      case 'funnel_started':
        if (attempt.entryKind === 'complete') mark('started')
        break
      case 'step_viewed': lastObservedStep = event.data.step; break
      case 'service_considered': considered.add(event.data.serviceId); break
      case 'selection_context_changed': {
        const next = event.data.context
        if (!sameService(context, next) || ['service', 'modality'].includes(event.data.reason)) {
          invalidate('service'); requiredProfessional = false
        } else if (!sameContext(context, next) || event.data.reason === 'professional') {
          evidence.delete('professional'); invalidate('time')
        } else if (localDate !== event.data.localDate || event.data.reason === 'date') {
          invalidate('date')
        } else if (event.data.reason === 'time') invalidate('time')
        else if (event.data.reason === 'payment') invalidate('payment')
        context = next
        localDate = event.data.localDate
        break
      }
      case 'service_selected': {
        const next = { serviceId: event.data.serviceId, modality: event.data.modality, professional: event.data.professional }
        if (!sameService(context, next)) { invalidate('service'); localDate = null }
        else if (!sameContext(context, next)) { evidence.delete('professional'); invalidate('time') }
        context = next
        requiredProfessional = event.data.professionalStepRequired
        selected.add(context.serviceId)
        lastObservedStep = 'service'
        mark('service')
        break
      }
      case 'professional_selected':
        if (!sameService(context, event.data) || !requiredProfessional || event.data.professional.kind === 'none') { gap = true; break }
        if (!sameContext(context, event.data)) { evidence.delete('professional'); invalidate('time') }
        context = event.data
        lastObservedStep = 'professional'
        mark('professional')
        break
      case 'date_selected':
        if (!compatible(event.data)) break
        if (localDate !== event.data.localDate) invalidate('date')
        localDate = event.data.localDate
        lastObservedStep = 'date'
        mark('date')
        break
      case 'time_selected':
        if (!compatible(event.data) || localDate !== event.data.localDate) { gap = true; break }
        // Broad buckets cannot establish identity of an exact time; context_changed carries actual changes.
        if (timeBucket !== event.data.timeBucket) invalidate('time')
        timeBucket = event.data.timeBucket
        lastObservedStep = 'time'
        mark('time')
        break
      case 'availability_result': {
        if (!sameContext(context, event.data) || localDate !== event.data.localDate) break
        const key = canonical([revision, context, localDate])
        if (event.data.requestGeneration <= (generations.get(key) ?? 0)) break
        generations.set(key, event.data.requestGeneration)
        if (event.data.result === 'error') availability.hasError = true
        else {
          availability.hasValidResult = true
          if (event.data.result === 'empty') {
            availability.hasEmpty = true
            const reason = event.data.reason ?? 'unknown'
            if (!availability.emptyReasons.includes(reason)) availability.emptyReasons.push(reason)
          }
        }
        break
      }
      case 'customer_step_completed': lastObservedStep = 'customer'; mark('customer'); break
      // Validation alone does not establish that the current payment preparation changed.
      // Actual changes arrive as selection_context_changed/payment_branch_viewed.
      case 'promotion_result': break
      case 'payment_branch_viewed': {
        const next = canonical(event.data)
        if (paymentKey !== next) invalidate('payment')
        paymentKey = next
        offeredMethods = event.data.offeredMethods
        lastObservedStep = 'payment'
        mark('payment')
        break
      }
      case 'payment_method_selected':
        if (!offeredMethods.includes(event.data.method)) { gap = true; break }
        if (selectedMethod !== event.data.method) invalidate('submit')
        selectedMethod = event.data.method
        break
      case 'booking_submit_result':
        if (event.data.result === 'submitted' && context) {
          mark('submit')
          submissions.push({ revision, context, complete: prefix().includes('submit') })
        }
        break
      case 'checkout_redirected': break
    }
  }
  const validBookings = [...new Map(bookings.filter((b) => b.businessId === attempt.businessId && b.analyticsAttemptId === attempt.id && b.createdAt >= attempt.startedAt && b.createdAt < attempt.conversionDeadlineAt && b.createdAt <= now).map((b) => [b.id, b])).values()]
  const converted = validBookings.length > 0
  const convertedServices = [...new Set(validBookings.map((b) => b.serviceId))].sort()
  const conversionPathComplete = validBookings.some((b) => submissions.some((s) => s.complete && s.revision === b.analyticsSelectionRevision && s.context.serviceId === b.serviceId && s.context.modality === b.modality))
  const mature = now >= attempt.conversionDeadlineAt
  return {
    attempt, mature, converted, bookingsCreated: validBookings.length, conversionPathComplete, maxCoherentMilestones, maxCoherentContext,
    finalContext: context, finalRevision: revision, lastObservedStep, quality: gap ? 'incomplete' : 'observed',
    outcome: !mature ? 'in_progress' : converted ? 'converted' : gap || lastObservedStep === null ? 'measurement_incomplete' : 'known_interruption',
    consideredServices: [...considered].sort(), selectedServices: [...selected].sort(), convertedServices,
    convertedServicesWithInterest: convertedServices.filter((s) => considered.has(s)),
    convertedServicesWithoutInterest: convertedServices.filter((s) => !considered.has(s)), availability,
  }
}
