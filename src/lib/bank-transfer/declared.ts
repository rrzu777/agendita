// providerPaymentId determinístico del Payment "declarado por la clienta".
// Doble propósito (spec §3.4): hace morder el unique [bookingId, provider,
// providerPaymentId] (idempotencia real vía P2002) y discrimina la declaración
// de la clienta de un pago manual que registró la dueña.
export const BT_DECLARED_PREFIX = 'bt-declared:'

export function btDeclaredId(bookingId: string): string {
  return `${BT_DECLARED_PREFIX}${bookingId}`
}
