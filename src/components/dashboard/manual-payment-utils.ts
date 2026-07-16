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
  return (
    booking.remainingBalance > 0 &&
    // completed entra SOLO con saldo: recobro post-chargeback (spec FU-B4b-3 §6)
    // y saldo pendiente después de atender — mismo criterio que el saldo por
    // transferencia (allowCompleted).
    (booking.status === 'pending_payment' || booking.status === 'confirmed' || booking.status === 'completed')
  )
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
