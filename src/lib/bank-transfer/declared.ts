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

// "Esta reserva tiene una transferencia del ABONO pendiente de verificar."
// Fuente única del predicado que el dashboard deriva en varios lugares (tabla,
// card móvil, aviso home, conteo). Discrimina por `BT_DECLARED_PREFIX`, así que
// tolera arrays mixtos (getBookings trae abono Y saldo vía
// `anyDeclaredTransferWhere`): agarra solo los abonos sobre pending_payment.
export function hasPendingDeclaredTransfer(
  booking: { status: string; payments: Array<{ providerPaymentId?: string | null }> },
): boolean {
  return (
    booking.status === 'pending_payment' &&
    booking.payments.some((p) => p.providerPaymentId?.startsWith(BT_DECLARED_PREFIX))
  )
}

// ── Saldo restante (feature #3, spec 2026-07-11-saldo-por-transferencia) ──
// Prefijo PROPIO y explícito (no un sufijo de bt-declared:): ninguna query de
// abono debe matchear un saldo por accidente. Verificado: 'bt-balance:' no
// satisface startsWith('bt-declared:').
export const BT_BALANCE_PREFIX = 'bt-balance:'

export function btBalanceId(bookingId: string): string {
  return `${BT_BALANCE_PREFIX}${bookingId}`
}

// Estados "firmes" donde el saldo por transferencia aplica: la reserva ya está
// pagada de abono (o atendida), sin hold ni cupo en juego. Fuente única para
// no repetir el par confirmed/completed en cada predicado y query del saldo.
export const FIRM_BOOKING_STATUSES = ['confirmed', 'completed'] as const

export function isFirmBooking(status: string): boolean {
  return status === 'confirmed' || status === 'completed'
}

export const declaredBalancePaymentWhere = {
  provider: 'manual',
  status: 'pending',
  providerPaymentId: { startsWith: BT_BALANCE_PREFIX },
} satisfies Prisma.PaymentWhereInput

export function isDeclaredBalancePayment(
  p: { provider: string; status: string; providerPaymentId?: string | null },
): boolean {
  return (
    p.provider === 'manual' &&
    p.status === 'pending' &&
    !!p.providerPaymentId?.startsWith(BT_BALANCE_PREFIX)
  )
}

// Abono O saldo pendientes: para superficies de verificación de la dueña y
// sweeps de cancelación (cancelBooking / updateBookingStatus).
export const anyDeclaredTransferWhere = {
  provider: 'manual',
  status: 'pending',
  OR: [
    { providerPaymentId: { startsWith: BT_DECLARED_PREFIX } },
    { providerPaymentId: { startsWith: BT_BALANCE_PREFIX } },
  ],
} satisfies Prisma.PaymentWhereInput

// "Reserva firme con transferencia del SALDO pendiente de verificar."
// Badge ADICIONAL en el dashboard (no reemplaza Confirmada/Completada).
export function hasPendingBalanceTransfer(
  booking: { status: string; payments: Array<{ providerPaymentId?: string | null }> },
): boolean {
  return (
    isFirmBooking(booking.status) &&
    booking.payments.some((p) => p.providerPaymentId?.startsWith(BT_BALANCE_PREFIX))
  )
}

// ── Transferencia de PAQUETE (B4b-3) ──
// Prefijo PROPIO y explícito: 'bt-pkg-declared:' NO satisface startsWith('bt-declared:'),
// así que ningún sweep/consulta de reservas agarra un pago de paquete por accidente.
export const BT_PKG_DECLARED_PREFIX = 'bt-pkg-declared:'

export function btPkgDeclaredId(purchaseId: string): string {
  return `${BT_PKG_DECLARED_PREFIX}${purchaseId}`
}

export const declaredPkgTransferPaymentWhere = {
  provider: 'manual',
  status: 'pending',
  providerPaymentId: { startsWith: BT_PKG_DECLARED_PREFIX },
} satisfies Prisma.PaymentWhereInput

export function isDeclaredPkgTransferPayment(
  p: { provider: string; status: string; providerPaymentId?: string | null },
): boolean {
  return (
    p.provider === 'manual' &&
    p.status === 'pending' &&
    !!p.providerPaymentId?.startsWith(BT_PKG_DECLARED_PREFIX)
  )
}

/** "Compra de paquete con una transferencia declarada pendiente de verificar."
 *  Fuente única del predicado que usan la lista de la dueña (getPendingPackageTransfers)
 *  y el contador del home. Pinnea el prefijo bt-pkg-declared (via declaredPkgTransferPaymentWhere),
 *  así un pago manual registrado por otra vía no cuenta como transferencia por verificar. */
export function pendingPackageTransferWhere(
  businessId: string,
  now: Date,
): Prisma.PackagePurchaseWhereInput {
  return {
    businessId,
    status: 'pending',
    source: 'online',
    holdExpiresAt: { gte: now },
    payments: { some: declaredPkgTransferPaymentWhere },
  }
}
