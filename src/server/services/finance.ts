import type { Prisma } from '@prisma/client'
import { BookingStatus, BookingPaymentStatus, PaymentProvider, PaymentType } from '@prisma/client'
import { assertBookingPayable } from '@/lib/bookings/payments'
import { isManuallyPayableStatus } from '@/lib/bookings/payable-statuses'
import { formatBookingNumber } from '@/lib/bookings/number'
import { activatePackagePurchaseInTx } from '@/lib/packages/activate'
import { declaredBalancePaymentWhere } from '@/lib/bank-transfer/declared'
import { findSlotConflict, type SlotConflict } from '@/lib/availability/validation'
import type { LedgerEntryType, LedgerDirection } from '@prisma/client'
// UserError acá es seguro para el caller NO migrado (webhook MP):
// UserError extends Error, así que todo `instanceof
// Error`/try-catch existente sigue funcionando idéntico. Todos los throws de
// este módulo son mensajes user-facing en español (invariantes de
// consistencia del pago/reserva) — no hay invariantes internas en inglés acá.
// Nuevos throws en este módulo deben mantener esto (español, user-facing).
import { UserError } from '@/lib/actions/result'

/**
 * Mapea Payment.paymentType al LedgerEntry.type correspondiente.
 * Usa switch exhaustivo: si el enum cambia, TypeScript lo hace visible.
 *
 * NOTA: manual_adjustment deja direction como gap — la implementación
 * actual siempre usa income; si se necesita dirección variable, documentar
 * como follow-up fuera de este prompt.
 */
export function mapPaymentTypeToLedgerEntryType(
  paymentType: PaymentType
): LedgerEntryType {
  switch (paymentType) {
    case 'deposit':
      return 'deposit_paid'
    case 'final_payment':
      return 'final_payment_paid'
    case 'full_payment':
      return 'full_payment_paid'
    case 'refund':
      return 'refund_issued'
    case 'cancellation_fee':
      return 'cancellation_fee_charged'
    case 'manual_adjustment':
      return 'adjustment'
    case 'package_purchase':
      return 'package_sale'
    default: {
      // Exhaustive check: si alguien agrega un nuevo PaymentType sin manejarlo,
      // TypeScript falla aquí.
      const _exhaustive: never = paymentType
      return _exhaustive
    }
  }
}

/**
 * Dirección del ledger según paymentType.
 * refund → expense; todos los demás → income.
 */
export function mapPaymentTypeToLedgerDirection(paymentType: PaymentType): LedgerDirection {
  if (paymentType === 'refund') return 'expense'
  return 'income'
}

/**
 * Description según paymentType para la entrada de ledger.
 */
export function getLedgerDescription(paymentType: PaymentType, bookingId: string, bookingNumber?: number | null): string {
  const suffix = `reserva ${formatBookingNumber(bookingNumber, bookingId)}`
  switch (paymentType) {
    case 'deposit':
      return `Abono para ${suffix}`
    case 'final_payment':
      return `Pago final para ${suffix}`
    case 'full_payment':
      return `Pago total para ${suffix}`
    case 'refund':
      return `Reembolso para ${suffix}`
    case 'cancellation_fee':
      return `Cargo por cancelación para ${suffix}`
    case 'manual_adjustment':
      return `Ajuste manual para ${suffix}`
    case 'package_purchase':
      return 'Venta de paquete'
    default: {
      const _exhaustive: never = paymentType
      return _exhaustive
    }
  }
}

/**
 * Suma NETA de los pagos aprobados de una reserva: los reembolsos restan. Los
 * montos se guardan siempre positivos, así que sin el signo un reembolso inflaría
 * el total y podría dejar la reserva como pagada después de devolver la plata.
 *
 * `excludePaymentId` sirve para preguntar "cuánto había pagado ANTES de este pago",
 * cuando el Payment ya quedó aprobado en la misma tx. Se descuenta en JS y no en el
 * WHERE a propósito: así la query es siempre la misma y "cuánto hay aprobado" tiene
 * una sola forma de preguntarse.
 */
async function sumApprovedPayments(
  tx: Prisma.TransactionClient,
  bookingId: string,
  opts?: { excludePaymentId?: string },
): Promise<number> {
  const payments = await tx.payment.findMany({
    where: { bookingId, status: 'approved' },
    select: { id: true, amount: true, paymentType: true },
  })
  return payments.reduce((sum, p) => {
    if (opts?.excludePaymentId && p.id === opts.excludePaymentId) return sum
    const sign = mapPaymentTypeToLedgerDirection(p.paymentType) === 'expense' ? -1 : 1
    return sum + sign * p.amount
  }, 0)
}

/**
 * Tipos de pago que representan a la CLIENTA pagando su reserva. Sólo estos pueden
 * caer en "pago inesperado": un reembolso, un cargo por cancelación o un ajuste
 * manual los origina la dueña a propósito, y que la reserva ya esté saldada no los
 * vuelve raros. Lista blanca a propósito: un PaymentType nuevo no se marca solo.
 */
const CUSTOMER_BOOKING_PAYMENT_TYPES: ReadonlySet<PaymentType> = new Set<PaymentType>([
  'deposit',
  'final_payment',
  'full_payment',
])

/** Descripción del asiento de un pago que entró sobre una reserva ya saldada. Vive
 *  al lado de `getLedgerDescription` porque es su rama excepcional; el mail a la
 *  dueña tiene su propia redacción (plantilla HTML completa), no pasa por acá. */
function unexpectedBookingPaymentDescription(bookingId: string, bookingNumber?: number | null): string {
  return `Pago inesperado para reserva ${formatBookingNumber(bookingNumber, bookingId)}: ya estaba pagada (revisar reembolso)`
}

/**
 * Por qué la reserva no podía recibir este pago, en castellano llano. FUENTE
 * ÚNICA del asiento de ledger y del mail a la dueña, así los dos cuentan lo mismo
 * —mismo criterio que `describeUnexpectedPackagePayment`.
 *
 * Sin sujeto a propósito: lo pone cada lado ("Pago inesperado para reserva #4738:
 * ya había vencido…" / "…pero la reserva ya había vencido…").
 */
function describeUnpayableBookingStatus(status: BookingStatus): string {
  switch (status) {
    case BookingStatus.expired:
      return 'ya había vencido y el horario se liberó'
    case BookingStatus.cancelled:
      return 'estaba cancelada'
    case BookingStatus.no_show:
      return 'estaba marcada como no asistió'
    case BookingStatus.pending_confirmation:
      return 'todavía estaba esperando tu confirmación'
    // Fail-safe: un estado nuevo del enum no debe quedar sin explicación. Los
    // pagables (pending_payment, confirmed, completed) nunca llegan acá.
    default:
      return `estaba en estado ${status}`
  }
}

/** Asiento de un pago que entró sobre una reserva cuyo estado no admite pagos. */
function unpayableBookingPaymentDescription(
  status: BookingStatus,
  bookingId: string,
  bookingNumber?: number | null,
): string {
  return `Pago inesperado para reserva ${formatBookingNumber(bookingNumber, bookingId)}: ${describeUnpayableBookingStatus(status)} (revisar reembolso)`
}

export interface ApplyApprovedPaymentInput {
  tx: Prisma.TransactionClient
  bookingId: string
  businessId: string
  amount: number
  currency: string
  provider: PaymentProvider
  providerPaymentId: string | null
  paymentType: PaymentType
  paymentMethod?: string | null
  rawPayload?: Prisma.InputJsonValue | undefined
  createdByUserId?: string | null
  /** Si se proporciona, se reusará/aprobará este Payment en lugar de buscar/crear uno nuevo. */
  paymentId?: string
  /**
   * Salta el chequeo de hold vencido en assertBookingPayable (no revive estados
   * terminales). Solo lo usa el verificador de transferencia, que ya re-validó
   * el cupo por su cuenta; evita escribir un holdExpiresAt falso solo para pasar.
   */
  skipHoldExpiryCheck?: boolean
  /**
   * Permite procesar pagos sobre una reserva `completed` (spec #3 §4: saldo por
   * transferencia declarado/pagado después de que la clienta fue atendida).
   * Ver `assertBookingPayable` en `@/lib/bookings/payments`.
   */
  allowCompleted?: boolean
  /**
   * Camino automatizado en el que NO hay a quién decirle "no": el webhook de
   * Mercado Pago. El cobro ya ocurrió, así que rechazarlo no lo deshace — sólo
   * hace que el webhook devuelva 500, que MP reintente para siempre el mismo
   * evento y que la plata no quede asentada en ningún lado.
   *
   * Con esta bandera el pago se registra igual, pase lo que pase con el estado de
   * la reserva: si la reserva no puede recibir pagos (vencida, cancelada, no
   * asistió) el asiento va como `overpayment` —fuera de los KPI de ingreso— la
   * reserva NO se toca y el motivo vuelve en `unconfirmedReason` para que el
   * caller le avise a la dueña. Espejo exacto de lo que la rama de paquetes ya
   * hace con `ACTIVATABLE_PURCHASE_STATUSES`.
   *
   * Los caminos interactivos (dueña en el dashboard, clienta post-checkout) NO la
   * usan: ahí sí hay una pantalla donde decir que no se pudo.
   */
  recordEvenIfNotPayable?: boolean
}

interface UpsertApprovedPaymentInput {
  tx: Prisma.TransactionClient
  businessId: string
  bookingId?: string | null
  packagePurchaseId?: string | null
  customerId: string
  amount: number
  currency: string
  provider: PaymentProvider
  providerPaymentId: string | null
  paymentType: PaymentType
  paymentMethod?: string | null
  rawPayload?: Prisma.InputJsonValue | undefined
  explicitPaymentId?: string
}

/** Shape mínimo del Payment que devuelve/maneja el tronco compartido. */
type UpsertedPayment = { id: string; amount: number; status: string; provider: string; providerPaymentId: string | null; paymentType: PaymentType }

/** Upsert idempotente del Payment aprobado (tronco compartido reserva/paquete).
 *  Devuelve el Payment y si ya estaba aprobado (para cortar temprano). */
async function upsertApprovedPayment(input: UpsertApprovedPaymentInput): Promise<{ payment: UpsertedPayment; alreadyApproved: boolean }> {
  const { tx, businessId, bookingId, packagePurchaseId, customerId, amount, currency, provider, providerPaymentId, paymentType, paymentMethod, rawPayload, explicitPaymentId } = input
  let payment: UpsertedPayment | null = null

  if (explicitPaymentId) {
    const found = await tx.payment.findUnique({ where: { id: explicitPaymentId } })
    if (!found) throw new UserError('Pago no encontrado')
    if (bookingId && found.bookingId !== bookingId) throw new UserError('El pago no corresponde a esta reserva')
    if (packagePurchaseId && found.packagePurchaseId !== packagePurchaseId) throw new UserError('El pago no corresponde a esta compra')
    if (found.businessId !== businessId) throw new UserError('El pago no pertenece al negocio')
    if (found.amount !== amount) throw new UserError('El monto no coincide con el pago registrado')
    if (found.provider !== provider) throw new UserError('El proveedor no coincide con el pago registrado')
    if (found.providerPaymentId !== providerPaymentId) throw new UserError('El providerPaymentId no coincide con el pago registrado')
    if (found.paymentType !== paymentType) throw new UserError('El tipo de pago no coincide con el pago registrado')
    payment = found
  } else if (providerPaymentId) {
    payment = await tx.payment.findFirst({
      where: { ...(bookingId ? { bookingId } : { packagePurchaseId }), provider, providerPaymentId },
    })
  }

  if (payment && payment.status === 'approved') {
    return { payment, alreadyApproved: true }
  }

  if (payment) {
    payment = await tx.payment.update({
      where: { id: payment.id },
      data: { status: 'approved', paidAt: new Date(), ...(rawPayload !== undefined && { rawPayload }) },
    })
  } else {
    payment = await tx.payment.create({
      data: {
        businessId, bookingId: bookingId ?? null, packagePurchaseId: packagePurchaseId ?? null, customerId,
        provider, providerPaymentId, amount, currency, status: 'approved',
        paymentType, paymentMethod: paymentMethod ?? null, paidAt: new Date(),
        ...(rawPayload !== undefined && { rawPayload }),
      },
    })
  }
  return { payment, alreadyApproved: false }
}

export async function applyApprovedPayment({
  tx,
  bookingId,
  businessId,
  amount,
  currency,
  provider,
  providerPaymentId,
  paymentType,
  paymentMethod,
  rawPayload,
  createdByUserId,
  paymentId: explicitPaymentId,
  skipHoldExpiryCheck,
  allowCompleted,
  recordEvenIfNotPayable,
}: ApplyApprovedPaymentInput): Promise<{
  booking: Awaited<ReturnType<typeof recalcBookingFromPayments>>['booking']
  wasConfirmed: boolean
  /**
   * El pago entró sobre una reserva que ya estaba saldada. El asiento quedó como
   * `overpayment` (fuera de los KPI de ingreso) y el caller debería avisarle a la
   * dueña para que decida el reembolso. No es excluyente con `wasConfirmed`.
   */
  wasUnexpected: boolean
  /**
   * La plata quedó asentada pero el turno NO quedó en pie. Si viene con algo, el
   * caller TIENE que avisarle a la dueña: es la única forma de que se entere.
   * Ver `UnconfirmedPaymentReason`.
   */
  unconfirmedReason: UnconfirmedPaymentReason | null
}> {
  if (amount <= 0) {
    throw new UserError('El monto debe ser positivo')
  }

  const booking = await tx.booking.findUnique({
    where: { id: bookingId },
  })

  if (!booking) {
    throw new UserError('Reserva no encontrada')
  }

  if (booking.businessId !== businessId) {
    throw new UserError('La reserva no pertenece al negocio')
  }

  // El estado de la reserva no admite pagos (vencida, cancelada, no asistió). En
  // los caminos interactivos esto lanza y ahí termina; en el webhook se asienta
  // igual y se avisa —ver `recordEvenIfNotPayable`.
  const statusBlocksPayment = !isManuallyPayableStatus(booking.status)
  if (!recordEvenIfNotPayable) {
    assertBookingPayable(booking, { allowExpiredHold: skipHoldExpiryCheck, allowCompleted })
  }

  /** El desenlace en un solo lugar: el estado de la reserva pesa más que el cupo
   *  (si no puede recibir pagos, nunca se preguntó por el horario). */
  const toUnconfirmedReason = (slotConflict: SlotConflict | null): UnconfirmedPaymentReason | null => {
    if (statusBlocksPayment) return { kind: 'booking_status', status: booking.status }
    return slotConflict ? { kind: 'slot_taken', conflict: slotConflict } : null
  }

  const { payment, alreadyApproved } = await upsertApprovedPayment({
    tx, businessId, bookingId, customerId: booking.customerId, amount, currency,
    provider, providerPaymentId, paymentType, paymentMethod, rawPayload,
    explicitPaymentId,
  })

  if (alreadyApproved) {
    // Idempotencia: ya aprobado; solo recalcular y retornar. Redelivery del mismo
    // pago no es plata nueva, así que nunca es un pago inesperado.
    const recalc = await recalcBookingFromPayments(tx, bookingId)
    return {
      booking: recalc.booking,
      wasConfirmed: recalc.wasConfirmed,
      wasUnexpected: false,
      unconfirmedReason: toUnconfirmedReason(recalc.slotConflict),
    }
  }

  // Plata NUEVA sobre una reserva que ya no debía nada. Casos reales: la clienta
  // arranca el checkout de MP, después paga por transferencia y la dueña confirma,
  // y MP aprueba tarde; o dos intentos de pago que terminan aprobados los dos.
  // El cobro es real y no se puede deshacer desde acá, pero tampoco es facturación:
  // se va a devolver. Se asienta como `overpayment` — visible y trazable en el
  // ledger, fuera de los KPI de ingreso — y el caller le avisa a la dueña para que
  // decida el reembolso (mismo reparto que un contracargo, igual que en paquetes).
  //
  // `finalAmount > 0` es fail-open a propósito: si por lo que sea una reserva quedó
  // en 0, sus pagos siguen contando como ingreso normal. Preferimos contar plata de
  // más en los KPI antes que esconder plata real.
  const paidBefore = await sumApprovedPayments(tx, bookingId, { excludePaymentId: payment.id })
  // `statusBlocksPayment` gana: si la reserva está vencida o cancelada, el aviso
  // que corresponde es "no quedó confirmada, decidí vos" y no "ya estaba pagada".
  // Excluyentes a propósito, así la dueña recibe UN mail y no dos.
  const wasUnexpected =
    !statusBlocksPayment &&
    booking.finalAmount > 0 &&
    CUSTOMER_BOOKING_PAYMENT_TYPES.has(payment.paymentType) &&
    paidBefore >= booking.finalAmount

  // Exactly one LedgerEntry per payment (upsert atómico sobre @@unique([paymentId])).
  await tx.ledgerEntry.upsert({
    where: { paymentId: payment.id },
    update: {},
    create: {
      businessId,
      bookingId,
      paymentId: payment.id,
      customerId: booking.customerId,
      // `overpayment` = plata real, trazable en el ledger, FUERA de los KPI de
      // ingreso. Es lo que corresponde a un cobro que se va a devolver o a
      // reacomodar: contarlo como facturación infla ingresos que se revierten.
      type: wasUnexpected || statusBlocksPayment
        ? 'overpayment'
        : mapPaymentTypeToLedgerEntryType(payment.paymentType),
      direction: mapPaymentTypeToLedgerDirection(payment.paymentType),
      amount: payment.amount,
      currency,
      description: statusBlocksPayment
        ? unpayableBookingPaymentDescription(booking.status, booking.id, booking.bookingNumber)
        : wasUnexpected
          ? unexpectedBookingPaymentDescription(booking.id, booking.bookingNumber)
          : getLedgerDescription(payment.paymentType, booking.id, booking.bookingNumber),
      occurredAt: new Date(),
      createdByUserId: createdByUserId ?? null,
    },
  })

  // `depositPaid` queda con el total REALMENTE pagado, sin tope: es un hecho, y
  // `remainingBalance` ya está clampeado en 0. Taparlo escondería el cobro de más
  // justo en la pantalla donde la dueña lo tiene que ver.
  const recalc = await recalcBookingFromPayments(tx, bookingId)
  return {
    booking: recalc.booking,
    wasConfirmed: recalc.wasConfirmed,
    wasUnexpected,
    unconfirmedReason: toUnconfirmedReason(recalc.slotConflict),
  }
}

export interface ApplyApprovedPackagePaymentInput {
  tx: Prisma.TransactionClient
  packagePurchaseId: string
  businessId: string
  amount: number
  currency: string
  provider: PaymentProvider
  providerPaymentId: string | null
  paymentType: PaymentType
  paymentMethod?: string | null
  rawPayload?: Prisma.InputJsonValue | undefined
  createdByUserId?: string | null
  paymentId?: string
}

/**
 * Desenlaces EXCLUYENTES de `applyApprovedPackagePayment`. Un solo campo en vez
 * de banderas sueltas: un `{ wasActivated: true, wasUnexpected: true }` no debería
 * ni poder escribirse.
 * - `activated`: primera aprobación, compra activada.
 * - `unexpected`: pago NUEVO sobre una compra que no lo esperaba (ya activa, ya
 *   reembolsada, rechazada por la dueña). No toca el paquete; sólo asienta el
 *   movimiento, y el caller debe avisarle a la dueña para que decida el reembolso.
 * - `noop`: redelivery del mismo pago ya aprobado. Nada que hacer.
 */
export type ApprovedPackagePaymentOutcome = 'activated' | 'unexpected' | 'noop'

/**
 * Estados de PackagePurchase en los que un pago aprobado SÍ debe activar. Es una
 * lista blanca a propósito: cualquier estado nuevo cae en la rama segura (asentar
 * + avisar) en vez de activar por descuido.
 * - `pending`: el caso normal, la compra esperaba el pago.
 * - `expired`: el hold venció pero la clienta pagó igual, sólo que tarde. Un
 *   paquete no bloquea cupo, así que se revive (mismo criterio que B4b-3).
 */
const ACTIVATABLE_PURCHASE_STATUSES: ReadonlySet<string> = new Set(['pending', 'expired'])

/** Por qué un pago aprobado no activó, en castellano llano. Fuente única para el
 *  asiento de ledger y para el mail a la dueña, así los dos cuentan lo mismo. */
export function describeUnexpectedPackagePayment(purchaseStatus: string): string {
  switch (purchaseStatus) {
    case 'active':
      return 'el paquete ya estaba pagado y activo'
    case 'refunded':
      return 'el paquete ya se había reembolsado'
    case 'rejected':
      return 'la compra estaba rechazada'
    default:
      return `la compra estaba en estado ${purchaseStatus}`
  }
}

/**
 * Entró plata y el turno NO quedó en pie. Dos motivos EXCLUYENTES entre sí:
 * - `slot_taken`: la reserva podía confirmarse pero el horario ya no está libre.
 *   Exige `pending_payment`, o sea un estado que sí admite pagos.
 * - `booking_status`: el estado de la reserva no admite pagos (vencida,
 *   cancelada, no asistió). Ahí nunca se llega a preguntar por el horario.
 *
 * Van en un solo tipo porque el desenlace es el mismo —el cobro es real, la hora
 * no está reservada y decide la dueña— y viajan por el mismo aviso.
 */
export type UnconfirmedPaymentReason =
  | { kind: 'slot_taken'; conflict: SlotConflict }
  | { kind: 'booking_status'; status: BookingStatus }

/** Por qué no se pudo confirmar el turno, en castellano llano para el mail a la
 *  dueña. Vive al lado de `describeUnexpectedPackagePayment` por el mismo motivo:
 *  el aviso tiene que decir qué pasó, no un código interno. */
export function describeUnconfirmedPayment(reason: UnconfirmedPaymentReason): string {
  if (reason.kind === 'booking_status') {
    return `la reserva ${describeUnpayableBookingStatus(reason.status)}`
  }
  switch (reason.conflict.reason) {
    case 'booking_overlap':
      return 'ese horario ya lo tomó otra reserva'
    case 'timeblock_overlap':
      return 'ese horario quedó bloqueado en tu agenda'
    case 'end_before_start':
      return 'el horario de la reserva quedó inconsistente'
  }
}

/**
 * Lo que se le dice a la CLIENTA cuando su pago entró pero su hora no quedó
 * reservada. Separado del texto del mail a la dueña a propósito: son dos lectores
 * distintos y el de la clienta no debe hablar de la agenda del negocio.
 */
export function unconfirmedPaymentCustomerMessage(reason: UnconfirmedPaymentReason): string {
  const causa =
    reason.kind === 'slot_taken'
      ? 'ese horario acaba de ocuparse'
      : 'esa reserva ya no estaba vigente'
  return `Recibimos tu pago, pero ${causa}. El negocio te va a contactar para reacomodar tu hora o devolverte la plata.`
}

/**
 * Rama paquete de la aprobación de pago (polimórfica con applyApprovedPayment).
 * Carga la PackagePurchase, upserta el Payment (packagePurchaseId, sin booking)
 * y, si la compra estaba pending, la activa (grants + asiento de ledger). NO
 * toca recalcBookingFromPayments. Idempotente.
 */
export async function applyApprovedPackagePayment({
  tx, packagePurchaseId, businessId, amount, currency, provider, providerPaymentId,
  paymentType, paymentMethod, rawPayload, createdByUserId, paymentId: explicitPaymentId,
}: ApplyApprovedPackagePaymentInput): Promise<{ outcome: ApprovedPackagePaymentOutcome }> {
  if (amount <= 0) throw new UserError('El monto debe ser positivo')

  const purchase = await tx.packagePurchase.findUnique({ where: { id: packagePurchaseId } })
  if (!purchase) throw new UserError('Compra de paquete no encontrada')
  if (purchase.businessId !== businessId) throw new UserError('La compra no pertenece al negocio')

  const { payment, alreadyApproved } = await upsertApprovedPayment({
    tx, businessId, packagePurchaseId, customerId: purchase.customerId, amount, currency,
    provider, providerPaymentId, paymentType, paymentMethod, rawPayload, explicitPaymentId,
  })

  // Idempotencia real: el MISMO pago ya estaba aprobado (redelivery de MP) → no
  // hay plata nueva, no hay nada que hacer. El `noop` evita que el caller
  // (webhook) re-envíe notificaciones en cada reintento — espejo del
  // `wasConfirmed` de la rama de reserva.
  if (alreadyApproved) return { outcome: 'noop' }

  // Pago NUEVO sobre una compra que no lo esperaba. Casos reales: la clienta
  // arranca el checkout de MP, después paga por transferencia y la dueña confirma
  // (`active`) o la rechaza (`rejected`), y MP aprueba tarde; o entra un cargo
  // sobre un paquete ya reembolsado (`refunded`). Ninguno debe pasar por el
  // activador: duplicaría grants, resucitaría un paquete devuelto o pisaría el "no"
  // de la dueña — y sobre `refunded` ni siquiera podría, porque los grants
  // reversados conservan su requestId y el P2002 tumbaría la tx (webhook 500 →
  // MP reintentando para siempre). Pero callar deja plata cobrada invisible en los
  // libros. Asentamos y avisamos: la dueña decide si devuelve (mismo reparto que
  // un contracargo).
  if (!ACTIVATABLE_PURCHASE_STATUSES.has(purchase.status)) {
    await tx.ledgerEntry.upsert({
      where: { paymentId: payment.id },
      update: {},
      create: {
        businessId,
        packagePurchaseId: purchase.id,
        paymentId: payment.id,
        customerId: purchase.customerId,
        // `manual_income` + packagePurchaseId seteado lo deja visible y trazable
        // en el ledger pero FUERA de todos los KPI de ingreso (los de reserva
        // filtran packagePurchaseId: null; los de paquete, type 'package_sale').
        // Deliberado: un cargo duplicado que se va a devolver no es facturación,
        // y sumarlo inflaría plata que después se revierte.
        type: 'manual_income',
        direction: 'income',
        amount: payment.amount,
        currency,
        description: `Pago inesperado: ${describeUnexpectedPackagePayment(purchase.status)} (revisar reembolso)`,
        occurredAt: new Date(),
        createdByUserId: createdByUserId ?? null,
      },
    })
    return { outcome: 'unexpected' }
  }

  await activatePackagePurchaseInTx(tx, purchase, { requestId: purchase.id, paymentId: payment.id, createdByUserId })
  return { outcome: 'activated' }
}

/**
 * ¿Hay algo que impida CONFIRMAR este turno ahora mismo? Se pregunta justo antes
 * del flip `pending_payment → confirmed`, que es el único momento en que la
 * reserva pasa a ocupar cupo de verdad.
 *
 * El chequeo de hold vencido de `assertBookingPayable` NO cubre esto: es un proxy
 * (¿sigue vivo el hold?) y no la pregunta real (¿sigue libre el horario?). Entre
 * que nació el hold y que llegó el pago, el horario pudo habérselo llevado otra
 * clienta —el hold vencido deja de bloquear el slot al instante, sin esperar al
 * cron— o un bloqueo que la dueña creó encima.
 */
async function findConfirmationSlotConflict(
  tx: Prisma.TransactionClient,
  booking: { id: string; businessId: string; startDateTime: Date; endDateTime: Date },
): Promise<SlotConflict | null> {
  // Un turno que ya pasó no tiene cupo que proteger, y una fila solapada vieja
  // bloquearía para siempre el registro de un pago legítimo — el mismo criterio
  // (y el mismo motivo) que la re-validación de `bank-transfer-verify.ts`.
  if (booking.startDateTime <= new Date()) return null

  const business = await tx.business.findUnique({
    where: { id: booking.businessId },
    select: { timezone: true },
  })

  return findSlotConflict({
    tx,
    businessId: booking.businessId,
    startDateTime: booking.startDateTime,
    endDateTime: booking.endDateTime,
    timezone: business?.timezone || 'America/Santiago',
    // Su propio hold no compite consigo mismo.
    excludeBookingId: booking.id,
  })
}

export async function recalcBookingFromPayments(
  tx: Prisma.TransactionClient,
  bookingId: string,
  opts?: { paymentStatusOverride?: BookingPaymentStatus },
): Promise<{
  booking: { id: string; status: string; businessId: string; customerId: string; totalPrice: number; depositRequired: number; depositPaid: number; remainingBalance: number; finalAmount: number; paymentStatus: string }
  wasConfirmed: boolean
  /**
   * El pago alcanzaba para confirmar pero el horario ya no está libre. La plata
   * queda asentada igual (el cobro es real y no se deshace desde acá) y la reserva
   * NO se confirma: decide la dueña, reacomodar o reembolsar. El caller le tiene
   * que avisar — nadie más se va a enterar.
   */
  slotConflict: SlotConflict | null
}> {
  const booking = await tx.booking.findUnique({
    where: { id: bookingId },
  })
  if (!booking) throw new UserError('Reserva no encontrada')

  const totalApproved = await sumApprovedPayments(tx, bookingId)
  const newDepositPaid = Math.max(0, totalApproved)
  const newRemainingBalance = Math.max(0, booking.finalAmount - newDepositPaid)

  // Autolimpieza (spec §5-bis): si el saldo quedó en 0 por CUALQUIER camino
  // (pago manual, MP, verificación del propio saldo), una declaración de saldo
  // pendiente ya no tiene sentido — cancelarla evita un chip "por verificar"
  // eterno cuyo único destino sería un rechazo con email confuso.
  if (newRemainingBalance === 0) {
    await tx.payment.updateMany({
      where: { bookingId, ...declaredBalancePaymentWhere },
      data: { status: 'cancelled' },
    })
  }

  let newPaymentStatus: BookingPaymentStatus
  if (totalApproved >= booking.finalAmount) {
    newPaymentStatus = BookingPaymentStatus.fully_paid
  } else if (totalApproved >= booking.depositRequired) {
    newPaymentStatus = BookingPaymentStatus.deposit_paid
  } else {
    newPaymentStatus = BookingPaymentStatus.unpaid
  }

  // Reversión de pago (chargeback/refund MP): el caller quiere los montos
  // verdaderos pero con el marcador 'refunded' en vez del estado derivado.
  if (opts?.paymentStatusOverride) newPaymentStatus = opts.paymentStatusOverride

  const shouldConfirm =
    booking.status === BookingStatus.pending_payment &&
    totalApproved >= booking.depositRequired

  // Sólo se pregunta cuando este pago iba a confirmar: los recálculos que no
  // cambian el status (redeliveries, reversiones, saldos) no pagan el costo de la
  // query ni pueden quedar bloqueados por un conflicto que no les corresponde.
  const slotConflict = shouldConfirm ? await findConfirmationSlotConflict(tx, booking) : null

  if (shouldConfirm && !slotConflict) {
    // Atomic: only transitions if still pending_payment. Avoids two concurrent
    // transactions both returning wasConfirmed=true for the same booking.
    const result = await tx.booking.updateMany({
      where: { id: bookingId, status: BookingStatus.pending_payment },
      data: {
        depositPaid: newDepositPaid,
        remainingBalance: newRemainingBalance,
        paymentStatus: newPaymentStatus,
        status: BookingStatus.confirmed,
      },
    })

    if (result.count > 0) {
      return {
        booking: {
          id: booking.id,
          status: BookingStatus.confirmed,
          businessId: booking.businessId,
          customerId: booking.customerId,
          totalPrice: booking.totalPrice,
          depositRequired: booking.depositRequired,
          depositPaid: newDepositPaid,
          remainingBalance: newRemainingBalance,
          finalAmount: booking.finalAmount,
          paymentStatus: newPaymentStatus,
        },
        wasConfirmed: true,
        slotConflict: null,
      }
    }

    // Another tx already confirmed this booking. Refetch and recalc without status change.
    const refetched = await tx.booking.findUnique({ where: { id: bookingId } })
    if (!refetched) throw new UserError('Reserva no encontrada')

    const updated = await tx.booking.update({
      where: { id: bookingId },
      data: {
        depositPaid: newDepositPaid,
        remainingBalance: newRemainingBalance,
        paymentStatus: newPaymentStatus,
      },
    })

    return { booking: updated, wasConfirmed: false, slotConflict: null }
  }

  // No hacía falta confirmar —o no se pudo, porque el horario ya está tomado— así
  // que sólo se asientan los montos. Con `slotConflict` la reserva queda tal cual
  // estaba (`pending_payment`) con la plata registrada: es exactamente el estado
  // que la dueña necesita ver para decidir.
  const updated = await tx.booking.update({
    where: { id: bookingId },
    data: {
      depositPaid: newDepositPaid,
      remainingBalance: newRemainingBalance,
      paymentStatus: newPaymentStatus,
    },
  })

  return { booking: updated, wasConfirmed: false, slotConflict }
}
