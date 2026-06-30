export type ManualPaymentMode = 'fixed' | 'percentage'

export type ManualPaymentBooking = {
  id: string
  status: string
  depositPaid: number
  depositRequired: number
  finalAmount: number
  remainingBalance: number
  service: { name: string } | null
  customer: { name: string } | null
}

export function isManualPaymentAllowed(booking: Pick<ManualPaymentBooking, 'status' | 'remainingBalance'>) {
  return (
    booking.remainingBalance > 0 &&
    (booking.status === 'pending_payment' || booking.status === 'confirmed')
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
