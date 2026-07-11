/** Ventana de autogestión de la clienta (spec D1 §5): puede cancelar/reprogramar
 *  solo si startDateTime − now > cutoffHours (estrictamente). 0 = sin límite,
 *  pero una reserva pasada nunca es gestionable. La ventana aplica SOBRE EL
 *  HORARIO ACTUAL de la reserva; el slot nuevo se rige por las reglas del funnel. */
export function canSelfManage(startDateTime: Date, cutoffHours: number, now: Date = new Date()): boolean {
  const msUntilStart = startDateTime.getTime() - now.getTime()
  if (msUntilStart <= 0) return false
  if (cutoffHours === 0) return true
  return msUntilStart > cutoffHours * 3_600_000
}

/** Únicos status con transición válida a cancelled desde self-service. */
export const SELF_MANAGEABLE_STATUSES = ['pending_payment', 'confirmed'] as const
