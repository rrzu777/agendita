import { z } from 'zod'

export const dimensionIdSchema = z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/)
export const channelSchema = z.enum(['direct', 'instagram', 'facebook', 'whatsapp', 'google', 'referral', 'other', 'unknown'])
export const acquisitionSchema = z.strictObject({ channel: channelSchema, normalizationVersion: z.literal(1), acquisitionLinkId: dimensionIdSchema.nullable() })
export type AcquisitionSource = z.infer<typeof acquisitionSchema>
export const professionalSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('none') }),
  z.strictObject({ kind: z.literal('anyone') }),
  z.strictObject({ kind: z.literal('person'), professionalId: dimensionIdSchema }),
])
export const selectionContextSchema = z.strictObject({ serviceId: dimensionIdSchema, modality: z.enum(['on_site', 'at_home', 'online']), professional: professionalSchema })
export type SelectionContext = z.infer<typeof selectionContextSchema>
export const localDateSchema = z.string().regex(/^(20\d{2}|2100)-\d{2}-\d{2}$/).refine((value) => {
  const date = new Date(`${value}T00:00:00.000Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}, 'Invalid calendar date')
export const stepSchema = z.enum(['service', 'professional', 'date', 'time', 'customer', 'payment', 'confirmation'])
export const timeBucketSchema = z.enum(['00_06', '06_12', '12_18', '18_24'])
export const emptyReasonSchema = z.enum(['outside_booking_window', 'lead_time_restricted', 'not_offered', 'no_capacity', 'unknown'])
export const paymentMethodSchema = z.enum(['online', 'transfer', 'manual'])
const common = { version: z.literal(1), eventId: z.uuid(), sequence: z.number().int().min(1).max(2147483647) }
const revision = z.number().int().min(1).max(2147483647)
const empty = z.strictObject({})
const context = selectionContextSchema.shape
const payment = z.strictObject({
  screen: z.enum(['sin-abono', 'verificando', 'sin-pago-online', 'cobrar']),
  condition: z.enum(['package', 'promotion_zero', 'free_service', 'no_deposit', 'deposit_required']),
  offeredMethods: z.array(paymentMethodSchema).max(3).refine((xs) => new Set(xs).size === xs.length),
})
function event<T extends string, S extends z.ZodType>(type: T, data: S) {
  return z.strictObject({ ...common, type: z.literal(type), selectionRevision: revision, data })
}
/** Browser envelope contains no tenant/session/attempt identity or client clock. */
export const analyticsEventSchema = z.discriminatedUnion('type', [
  z.strictObject({ ...common, type: z.literal('public_profile_viewed'), data: empty }),
  z.strictObject({ ...common, type: z.literal('booking_entry_viewed'), data: empty }),
  event('funnel_started', empty),
  event('step_viewed', z.strictObject({ step: stepSchema })),
  event('service_considered', z.strictObject({ serviceId: dimensionIdSchema })),
  event('service_selected', z.strictObject({ ...context, professionalStepRequired: z.boolean() })),
  event('professional_selected', selectionContextSchema),
  event('date_selected', z.strictObject({ ...context, localDate: localDateSchema })),
  event('time_selected', z.strictObject({ ...context, localDate: localDateSchema, timeBucket: timeBucketSchema })),
  event('availability_result', z.strictObject({ ...context, localDate: localDateSchema, queryId: z.uuid(), requestGeneration: z.number().int().min(1).max(100000), result: z.enum(['available', 'empty', 'error']), reason: emptyReasonSchema.optional() }).refine((data) => data.result === 'empty' || data.reason === undefined)),
  event('customer_step_completed', empty),
  event('promotion_result', z.discriminatedUnion('result', [
    z.strictObject({ result: z.literal('accepted'), promotionId: dimensionIdSchema }),
    z.strictObject({ result: z.literal('rejected'), category: z.enum(['invalid', 'expired', 'ineligible', 'limit_reached', 'unknown']) }),
    z.strictObject({ result: z.literal('error'), category: z.enum(['network', 'unavailable', 'unknown']) }),
  ])),
  event('payment_branch_viewed', payment),
  event('payment_method_selected', z.strictObject({ method: paymentMethodSchema })),
  event('booking_submit_result', z.strictObject({ result: z.enum(['submitted', 'rejected', 'error']), category: z.enum(['validation', 'slot_unavailable', 'unauthorized', 'network', 'unknown']).optional() })),
  event('selection_context_changed', z.strictObject({ reason: z.enum(['service', 'modality', 'professional', 'date', 'time', 'payment', 'restore']), context: selectionContextSchema.nullable(), localDate: localDateSchema.nullable() })),
  event('checkout_redirected', z.strictObject({ provider: z.literal('mercado_pago') })),
])
export type AnalyticsEventInput = z.infer<typeof analyticsEventSchema>
export type AnalyticsEventType = AnalyticsEventInput['type']
export function eventScope(type: AnalyticsEventType): 'session' | 'attempt' {
  return type === 'public_profile_viewed' || type === 'booking_entry_viewed' ? 'session' : 'attempt'
}
