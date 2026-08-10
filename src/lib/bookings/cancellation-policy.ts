export interface CancellationPolicyBookingSnapshot {
  cancellationCutoffHours: number | null
  cancellationPolicySnapshot: string | null
}

export interface CancellationPolicyBusinessFallback {
  selfServiceCutoffHours: number
  cancellationPolicy: string | null
}

/**
 * Resuelve el contrato que aceptó la clienta al reservar.
 *
 * `cancellationCutoffHours === null` identifica una reserva legacy, creada
 * antes de que existieran los snapshots. Sólo en ese caso se consulta la
 * configuración actual del negocio. En una reserva nueva, una política
 * adicional `null` también es un snapshot válido y no debe heredarse luego.
 */
export function resolveCancellationPolicy(
  booking: CancellationPolicyBookingSnapshot,
  business: CancellationPolicyBusinessFallback,
): { cutoffHours: number; additionalPolicy: string | null } {
  if (booking.cancellationCutoffHours === undefined) {
    throw new Error('Booking projection missing cancellationCutoffHours')
  }

  if (booking.cancellationCutoffHours === null) {
    return {
      cutoffHours: business.selfServiceCutoffHours,
      additionalPolicy: business.cancellationPolicy,
    }
  }

  if (booking.cancellationPolicySnapshot === undefined) {
    throw new Error('Booking projection missing cancellationPolicySnapshot')
  }

  return {
    cutoffHours: booking.cancellationCutoffHours,
    additionalPolicy: booking.cancellationPolicySnapshot,
  }
}

export function cancellationWarningText(cutoffHours: number): string | null {
  if (cutoffHours <= 0) return null

  const unit = cutoffHours === 1 ? 'hora' : 'horas'
  return `Podés cancelar o reprogramar hasta ${cutoffHours} ${unit} antes. Con menos anticipación, el abono no se devuelve. Para cancelaciones anteriores aplica la política del negocio.`
}
