export type WeeklyActionId = 'review_funnel_completion' | 'review_availability' | 'review_service_interest'

export const WEEKLY_ACTIONS: Record<WeeklyActionId, { actionId: WeeklyActionId; label: string }> = {
  review_funnel_completion: { actionId: 'review_funnel_completion', label: 'Revisar dónde se detienen los intentos maduros.' },
  review_availability: { actionId: 'review_availability', label: 'Revisar horarios y capacidad frente a búsquedas sin disponibilidad.' },
  review_service_interest: { actionId: 'review_service_interest', label: 'Revisar servicios con interés observado y baja selección o conversión.' },
}

export function isWeeklyActionId(value: unknown): value is WeeklyActionId { return typeof value === 'string' && Object.hasOwn(WEEKLY_ACTIONS, value) }
