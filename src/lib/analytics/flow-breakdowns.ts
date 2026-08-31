import type { AttemptProjection, FlowBreakdownGroup, FlowErrorKey, FlowProfessionalKey } from './report-types'

export const FLOW_PROFESSIONAL_KEYS = ['anyone:explicit', 'anyone:not_observed', 'anyone:not_required', 'none:not_observed', 'none:not_required', 'not_observed', 'person:explicit', 'person:not_observed', 'person:not_required'] as const satisfies readonly FlowProfessionalKey[]
export const FLOW_SCREEN_KEYS = ['cobrar', 'not_observed', 'sin-abono', 'sin-pago-online', 'verificando'] as const
export const FLOW_CONDITION_KEYS = ['deposit_required', 'free_service', 'no_deposit', 'not_observed', 'package', 'promotion_zero'] as const
export const FLOW_METHOD_KEYS = ['manual', 'not_observed', 'online', 'transfer'] as const
export const FLOW_OFFERED_METHOD_KEYS = ['manual', 'none_offered', 'not_observed', 'online', 'transfer'] as const
export const FLOW_ERROR_KEYS = [
  'availability:error', 'promotion:error:network', 'promotion:error:unavailable', 'promotion:error:unknown',
  'promotion:rejected:expired', 'promotion:rejected:ineligible', 'promotion:rejected:invalid', 'promotion:rejected:limit_reached', 'promotion:rejected:unknown',
  'submission:error:network', 'submission:error:slot_unavailable', 'submission:error:unauthorized', 'submission:error:unknown', 'submission:error:validation',
  'submission:rejected:network', 'submission:rejected:slot_unavailable', 'submission:rejected:unauthorized', 'submission:rejected:unknown', 'submission:rejected:validation',
] as const satisfies readonly FlowErrorKey[]

function counters<K extends string>(keys: readonly K[]): Record<K, number> {
  return Object.fromEntries(keys.map(key => [key, 0])) as Record<K, number>
}

/** One input projection represents one attempt; identities never enter the output. */
export function aggregateFlowBreakdowns(projections: AttemptProjection[]): FlowBreakdownGroup[] {
  const groups: FlowBreakdownGroup[] = (['complete', 'partial'] as const).flatMap(entryKind => (['mature', 'in_progress'] as const).map(maturity => ({
    entryKind, maturity, attempts: 0, incompleteCapture: 0,
    professional: counters(FLOW_PROFESSIONAL_KEYS), screen: counters(FLOW_SCREEN_KEYS), condition: counters(FLOW_CONDITION_KEYS),
    selectedMethod: counters(FLOW_METHOD_KEYS), offeredMethods: counters(FLOW_OFFERED_METHOD_KEYS), errors: counters(FLOW_ERROR_KEYS),
  })))
  for (const p of projections) {
    const group = groups[(p.attempt.entryKind === 'partial' ? 2 : 0) + (p.mature ? 0 : 1)]
    group.attempts++
    if (p.quality === 'incomplete') group.incompleteCapture++
    const { professional, payment, errors } = p.flow
    const professionalKey: FlowProfessionalKey = professional ? `${professional.kind}:${professional.choice}` as FlowProfessionalKey : 'not_observed'
    group.professional[professionalKey]++
    group.screen[payment?.screen ?? 'not_observed']++
    group.condition[payment?.condition ?? 'not_observed']++
    group.selectedMethod[payment?.selectedMethod ?? 'not_observed']++
    if (!payment) group.offeredMethods.not_observed++
    else if (!payment.offeredMethods.length) group.offeredMethods.none_offered++
    else for (const method of new Set(payment.offeredMethods)) group.offeredMethods[method]++
    for (const error of new Set(errors)) group.errors[error]++
  }
  return groups
}
