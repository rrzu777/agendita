import type { Prisma } from '@prisma/client'

// Valor de Booking.paymentMethod cuando la clienta eligió transferencia.
// NO es un enum de Prisma a propósito (decisión 5 del spec): es solo una
// const TS para no repetir el magic string ni arriesgar typos silenciosos.
export const BANK_TRANSFER_METHOD = 'bank_transfer'

// Valor de PackagePurchase.paymentMethod cuando la clienta eligió transferencia
// (espejo de BANK_TRANSFER_METHOD para reservas): const TS, no enum, para no
// repetir el magic string ni arriesgar typos silenciosos en los 5 predicados
// que discriminan por método (derive, revive, /mi, cron, checkout).
export const PKG_TRANSFER_PAYMENT_METHOD = 'Transferencia'

// ── Factory de "transferencia declarada por la clienta" ──
// Las 3 familias (abono de reserva, saldo de reserva, compra de paquete) comparten
// la MISMA forma: un providerPaymentId con prefijo determinístico sobre un Payment
// manual+pending. Esta fábrica deriva las 3 piezas (id builder, where de Prisma,
// predicado en memoria) desde el prefijo, para no repetir el fragmento
// { provider:'manual', status:'pending', startsWith } — antes copiado a mano en
// cada familia, con el riesgo de olvidar una condición (p.ej. `status:'pending'`)
// en alguna copia y agarrar pagos ya procesados.
type DeclaredPaymentLike = { provider: string; status: string; providerPaymentId?: string | null }

function makeDeclaredTransferKind(prefix: string) {
  // `satisfies` (no anotación) preserva el tipo literal { startsWith: string },
  // así los consumidores y tests que leen `.providerPaymentId.startsWith` siguen tipando.
  const where = {
    provider: 'manual',
    status: 'pending',
    providerPaymentId: { startsWith: prefix },
  } satisfies Prisma.PaymentWhereInput
  return {
    /** providerPaymentId determinístico `${prefix}${entityId}`: hace morder el unique
     *  (idempotencia real vía P2002) y discrimina la declaración de la clienta de un
     *  pago manual registrado por la dueña. */
    id: (entityId: string) => `${prefix}${entityId}`,
    /** where-fragment reusable "declaración pendiente de verificar" (fuente única de
     *  las 3 condiciones). Spreadeable para añadir filtros (createdAt, bookingId…). */
    where,
    /** Misma condición sobre un Payment ya cargado en memoria. */
    is: (p: DeclaredPaymentLike): boolean =>
      p.provider === 'manual' &&
      p.status === 'pending' &&
      !!p.providerPaymentId?.startsWith(prefix),
  }
}

// ── Abono de reserva (feature original) ──
export const BT_DECLARED_PREFIX = 'bt-declared:'
export const {
  id: btDeclaredId,
  where: declaredTransferPaymentWhere,
  is: isDeclaredTransferPayment,
} = makeDeclaredTransferKind(BT_DECLARED_PREFIX)

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
export const {
  id: btBalanceId,
  where: declaredBalancePaymentWhere,
  is: isDeclaredBalancePayment,
} = makeDeclaredTransferKind(BT_BALANCE_PREFIX)

// Estados "firmes" donde el saldo por transferencia aplica: la reserva ya está
// pagada de abono (o atendida), sin hold ni cupo en juego. Fuente única para
// no repetir el par confirmed/completed en cada predicado y query del saldo.
export const FIRM_BOOKING_STATUSES = ['confirmed', 'completed'] as const

export function isFirmBooking(status: string): boolean {
  return status === 'confirmed' || status === 'completed'
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
export const {
  id: btPkgDeclaredId,
  where: declaredPkgTransferPaymentWhere,
  is: isDeclaredPkgTransferPayment,
} = makeDeclaredTransferKind(BT_PKG_DECLARED_PREFIX)

/** "Compra de paquete con una transferencia declarada pendiente de verificar."
 *  Fuente única del predicado que usan la lista de la dueña (getPendingPackageTransfers)
 *  y el contador del home. Pinnea el prefijo bt-pkg-declared (via declaredPkgTransferPaymentWhere),
 *  así un pago manual registrado por otra vía no cuenta como transferencia por verificar.
 *  SIN filtro de hold a propósito (fix zombie): el sweep exime a las declaradas de
 *  expirar (la plata pudo enviarse), así que una declarada con hold vencido debe
 *  seguir visible hasta que la dueña confirme o rechace — filtrarla la dejaba
 *  pending invisible para siempre. */
export function pendingPackageTransferWhere(businessId: string): Prisma.PackagePurchaseWhereInput {
  return {
    businessId,
    status: 'pending',
    source: 'online',
    payments: { some: declaredPkgTransferPaymentWhere },
  }
}
