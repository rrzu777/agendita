/**
 * Deriva el PaymentType para un pago manual según estado de la reserva.
 * Centraliza la semántica financiera — el cliente no es
 * fuente de verdad para la clasificación del ledger.
 *
 * Reglas:
 * - Si booking.depositPaid > 0 → final_payment
 * - Si amount >= booking.remainingBalance → full_payment
 * - Caso contrario → deposit
 */
export function deriveManualPaymentType(
  booking: { depositPaid: number; remainingBalance: number },
  amount: number,
): 'deposit' | 'final_payment' | 'full_payment' {
  if (booking.depositPaid > 0) {
    return 'final_payment'
  }
  if (amount >= booking.remainingBalance) {
    return 'full_payment'
  }
  return 'deposit'
}