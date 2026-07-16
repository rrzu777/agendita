/**
 * Estados de reserva en los que la dueña puede registrar un pago manual.
 * FUENTE ÚNICA compartida UI ↔ server: `isManualPaymentAllowed` (mostrar el
 * botón) y `assertBookingPayable` con `allowCompleted` (guard real del server)
 * derivan de esta lista — antes eran dos enumeraciones independientes que había
 * que mover en lockstep. Sin imports server-only: la consumen componentes.
 *
 * 'completed' entra SOLO con saldo (recobro post-chargeback / saldo tras
 * atender, spec FU-B4b-3 §6) — el gate de monto (remainingBalance) vive en
 * cada lado; acá solo se decide el status.
 */
export const MANUAL_PAYMENT_STATUSES = ['pending_payment', 'confirmed', 'completed'] as const

export function isManuallyPayableStatus(status: string): boolean {
  return (MANUAL_PAYMENT_STATUSES as readonly string[]).includes(status)
}
