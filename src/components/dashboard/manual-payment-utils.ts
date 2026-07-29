import { isManuallyPayableStatus } from '@/lib/bookings/payable-statuses'
import type { Vocabulary } from '@/lib/vocabulary'

export type ManualPaymentMode = 'fixed' | 'percentage'

// Formato "$1.000 CLP" de la UI de pagos del dashboard (distinto del Intl de
// lib/money). Fuente única para las tres superficies: registrar pago manual,
// verificar transferencia y la sección "por verificar".
export function formatManualPaymentMoney(amount: number, currency: string) {
  return `$${amount.toLocaleString('es-CL')} ${currency}`
}

export type ManualPaymentBooking = {
  id: string
  bookingNumber: number | null
  status: string
  depositPaid: number
  depositRequired: number
  finalAmount: number
  remainingBalance: number
  service: { name: string } | null
  customer: { name: string } | null
  // Opcional: solo lo traen los llamadores que ya consultan `payments`
  // (getBookings). Habilita el aviso de "saldo por verificar" en el diálogo
  // sin forzar a los demás llamadores a agregar la relación.
  payments?: Array<{ providerPaymentId?: string | null }>
}

export function isManualPaymentAllowed(booking: Pick<ManualPaymentBooking, 'status' | 'remainingBalance'>) {
  // Estados desde la fuente única compartida con assertBookingPayable (server);
  // el gate de monto (saldo > 0) es propio de esta superficie.
  return booking.remainingBalance > 0 && isManuallyPayableStatus(booking.status)
}

export function calculateManualPaymentAmount({
  mode,
  value,
  remainingBalance,
}: {
  mode: ManualPaymentMode
  value: number
  remainingBalance: number
}) {
  if (!Number.isFinite(value) || value <= 0) return 0
  if (mode === 'percentage') {
    return Math.min(remainingBalance, Math.round((remainingBalance * value) / 100))
  }
  return Math.min(remainingBalance, Math.round(value))
}

export function getManualPaymentSuggestion({
  depositPaid,
  depositRequired,
  remainingBalance,
}: Pick<ManualPaymentBooking, 'depositPaid' | 'depositRequired' | 'remainingBalance'>) {
  if (remainingBalance <= 0) {
    return { amount: 0, label: 'Sin saldo pendiente' }
  }

  if (depositPaid <= 0 && depositRequired > 0) {
    return {
      amount: Math.min(depositRequired, remainingBalance),
      label: 'Abono configurado',
    }
  }

  return {
    amount: remainingBalance,
    label: 'Saldo pendiente',
  }
}

/**
 * Confirmación de "rechazar transferencia". Vive acá porque el diálogo de
 * verificación y la sección "por verificar" la muestran idéntica, y el texto del
 * saldo cambia con el rubro — duplicarla era duplicar también la interpolación.
 *
 * Rechazar el ABONO cancela la reserva; rechazar el SALDO no, y por eso invita a
 * volver a avisar.
 */
export function rejectTransferConfirmMessage(kind: 'deposit' | 'balance', vocabulary: Vocabulary): string {
  return kind === 'balance'
    ? `¿Rechazar esta transferencia del saldo? La reserva NO se cancela; ${vocabulary.theClient} podrá volver a avisar.`
    : '¿Rechazar esta transferencia? Se cancelará la reserva.'
}
