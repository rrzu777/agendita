import type { Prisma } from '@prisma/client'

// Valor de Booking.paymentMethod cuando la clienta eligió transferencia.
// NO es un enum de Prisma a propósito (decisión 5 del spec): es solo una
// const TS para no repetir el magic string ni arriesgar typos silenciosos.
export const BANK_TRANSFER_METHOD = 'bank_transfer'

// providerPaymentId determinístico del Payment "declarado por la clienta".
// Doble propósito (spec §3.4): hace morder el unique [bookingId, provider,
// providerPaymentId] (idempotencia real vía P2002) y discrimina la declaración
// de la clienta de un pago manual que registró la dueña.
export const BT_DECLARED_PREFIX = 'bt-declared:'

export function btDeclaredId(bookingId: string): string {
  return `${BT_DECLARED_PREFIX}${bookingId}`
}

// where-fragment reusable: "declaración de la clienta pendiente de verificar".
// Fuente única de las 3 condiciones (provider + status + prefijo); lo usan /mi,
// y lo van a usar el aviso home, cancelBooking y el cron (PR C). Escribirlo a
// mano en cada lugar arriesga olvidar `status: 'pending'` y agarrar pagos ya
// procesados.
export const declaredTransferPaymentWhere = {
  provider: 'manual',
  status: 'pending',
  providerPaymentId: { startsWith: BT_DECLARED_PREFIX },
} satisfies Prisma.PaymentWhereInput

// Misma condición sobre un Payment ya cargado en memoria (deriveConfirmationState).
export function isDeclaredTransferPayment(
  p: { provider: string; status: string; providerPaymentId?: string | null },
): boolean {
  return (
    p.provider === 'manual' &&
    p.status === 'pending' &&
    !!p.providerPaymentId?.startsWith(BT_DECLARED_PREFIX)
  )
}

// "Esta reserva tiene una transferencia declarada pendiente de verificar."
// Fuente única del predicado que el dashboard deriva en varios lugares (tabla,
// card móvil, aviso home, conteo). Asume que `payments` ya viene filtrado por
// `declaredTransferPaymentWhere` (como lo trae getBookings): un array no vacío
// sobre una reserva pending_payment = "por verificar".
export function hasPendingDeclaredTransfer(
  booking: { status: string; payments: unknown[] },
): boolean {
  return booking.status === 'pending_payment' && booking.payments.length > 0
}
