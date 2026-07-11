import { BANK_TRANSFER_METHOD } from '@/lib/bank-transfer/declared'

// Fuente única del cálculo "¿se puede dar nuevo plazo?" para la fila de tabla
// (booking-row-actions) y la card móvil (bookings/page.tsx): mismas 3
// condiciones que revalida el server en reviveBooking (turno futuro +
// transferencia + cuenta habilitada). El server es la autoridad real — esto
// solo evita mostrar el botón habilitado cuando ya sabemos que va a fallar.
export function getReviveReopenState(
  booking: { startDateTime: Date | string; paymentMethod: string | null },
  transferEnabled: boolean,
): { canReopen: boolean; reason: string | null } {
  const isFuture = new Date(booking.startDateTime) > new Date()
  const isTransfer = booking.paymentMethod === BANK_TRANSFER_METHOD
  const canReopen = isFuture && isTransfer && transferEnabled
  if (canReopen) return { canReopen: true, reason: null }
  const reason = !isFuture
    ? 'El turno ya pasó: solo se puede confirmar.'
    : !isTransfer
      ? 'Esta reserva no eligió transferencia: confirmala y registrá el pago aparte.'
      : 'La transferencia bancaria está deshabilitada en Pagos.'
  return { canReopen: false, reason }
}
