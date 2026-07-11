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

/** Mensaje único de la política de ventana (actions, page y componente lo comparten
 *  para que el copy no driftee entre superficies). */
export function selfServiceBlockedMessage(
  cutoffHours: number,
  action: 'cancelar' | 'reprogramar' | 'cancelar o reprogramar' = 'cancelar o reprogramar',
): string {
  return cutoffHours === 0
    ? 'Esta reserva ya no se puede modificar.'
    : `Las reservas se pueden ${action} hasta ${cutoffHours} horas antes. Contacta al negocio para cambios de último minuto.`
}

/** Where compartido de las reservas autogestionables de una clienta: ownership
 *  (customer.userId) y status EN el filtro — los endpoints de my-bookings deben
 *  usar exactamente este filtro para no divergir en autorización. */
export function ownedManageableBookingWhere(bookingId: string, userId: string) {
  return {
    id: bookingId,
    status: { in: [...SELF_MANAGEABLE_STATUSES] },
    customer: { userId },
  }
}
