import type { Prisma } from '@prisma/client'
import { BookingStatus, BookingPaymentStatus, PaymentProvider, PaymentType } from '@prisma/client'
import { assertBookingPayable } from '@/lib/booking-payments'
import { formatBookingNumber } from '@/lib/bookings/number'
import { activatePackagePurchaseInTx } from '@/lib/packages/activate'
import type { LedgerEntryType, LedgerDirection } from '@prisma/client'

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
      return `Venta de paquete`
    default: {
      const _exhaustive: never = paymentType
      return _exhaustive
    }
  }
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

/** Upsert idempotente del Payment aprobado (tronco compartido reserva/paquete).
 *  Devuelve el Payment y si ya estaba aprobado (para cortar temprano). */
async function upsertApprovedPayment(input: UpsertApprovedPaymentInput): Promise<{ payment: { id: string; amount: number; status: string; provider: string; providerPaymentId: string | null; paymentType: PaymentType }; alreadyApproved: boolean }> {
  const { tx, businessId, bookingId, packagePurchaseId, customerId, amount, currency, provider, providerPaymentId, paymentType, paymentMethod, rawPayload, explicitPaymentId } = input
  let payment: { id: string; amount: number; status: string; provider: string; providerPaymentId: string | null; paymentType: PaymentType } | null = null

  if (explicitPaymentId) {
    const found = await tx.payment.findUnique({ where: { id: explicitPaymentId } })
    if (!found) throw new Error('Pago no encontrado')
    if (bookingId && found.bookingId !== bookingId) throw new Error('El pago no corresponde a esta reserva')
    if (packagePurchaseId && found.packagePurchaseId !== packagePurchaseId) throw new Error('El pago no corresponde a esta compra')
    if (found.businessId !== businessId) throw new Error('El pago no pertenece al negocio')
    if (found.amount !== amount) throw new Error('El monto no coincide con el pago registrado')
    if (found.provider !== provider) throw new Error('El proveedor no coincide con el pago registrado')
    if (found.providerPaymentId !== providerPaymentId) throw new Error('El providerPaymentId no coincide con el pago registrado')
    if (found.paymentType !== paymentType) throw new Error('El tipo de pago no coincide con el pago registrado')
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
}: ApplyApprovedPaymentInput): Promise<{ booking: Awaited<ReturnType<typeof recalcBookingFromPayments>>['booking']; wasConfirmed: boolean }> {
  if (amount <= 0) {
    throw new Error('El monto debe ser positivo')
  }

  const booking = await tx.booking.findUnique({
    where: { id: bookingId },
  })

  if (!booking) {
    throw new Error('Reserva no encontrada')
  }

  if (booking.businessId !== businessId) {
    throw new Error('La reserva no pertenece al negocio')
  }

  assertBookingPayable(booking, { allowExpiredHold: skipHoldExpiryCheck })

  const { payment, alreadyApproved } = await upsertApprovedPayment({
    tx, businessId, bookingId, customerId: booking.customerId, amount, currency,
    provider, providerPaymentId, paymentType, paymentMethod, rawPayload,
    explicitPaymentId,
  })

  if (alreadyApproved) {
    // Idempotencia: ya aprobado; solo recalcular y retornar.
    return recalcBookingFromPayments(tx, bookingId)
  }

  // Exactly one LedgerEntry per payment (upsert atómico sobre @@unique([paymentId])).
  await tx.ledgerEntry.upsert({
    where: { paymentId: payment.id },
    update: {},
    create: {
      businessId,
      bookingId,
      paymentId: payment.id,
      customerId: booking.customerId,
      type: mapPaymentTypeToLedgerEntryType(payment.paymentType),
      direction: mapPaymentTypeToLedgerDirection(payment.paymentType),
      amount: payment.amount,
      currency,
      description: getLedgerDescription(payment.paymentType, booking.id, booking.bookingNumber),
      occurredAt: new Date(),
      createdByUserId: createdByUserId ?? null,
    },
  })

  return recalcBookingFromPayments(tx, bookingId)
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
 * Rama paquete de la aprobación de pago (polimórfica con applyApprovedPayment).
 * Carga la PackagePurchase, upserta el Payment (packagePurchaseId, sin booking)
 * y, si la compra estaba pending, la activa (grants + asiento de ledger). NO
 * toca recalcBookingFromPayments. Idempotente. Sin caller público en B4b-1 —
 * la usará el webhook MP en B4b-2.
 */
export async function applyApprovedPackagePayment({
  tx, packagePurchaseId, businessId, amount, currency, provider, providerPaymentId,
  paymentType, paymentMethod, rawPayload, createdByUserId, paymentId: explicitPaymentId,
}: ApplyApprovedPackagePaymentInput): Promise<void> {
  if (amount <= 0) throw new Error('El monto debe ser positivo')

  const purchase = await tx.packagePurchase.findUnique({ where: { id: packagePurchaseId } })
  if (!purchase) throw new Error('Compra de paquete no encontrada')
  if (purchase.businessId !== businessId) throw new Error('La compra no pertenece al negocio')

  const { payment, alreadyApproved } = await upsertApprovedPayment({
    tx, businessId, packagePurchaseId, customerId: purchase.customerId, amount, currency,
    provider, providerPaymentId, paymentType, paymentMethod, rawPayload, explicitPaymentId,
  })

  // Idempotencia: si el pago ya estaba aprobado o la compra ya está activa, no
  // re-emitir grants ni re-asentar (los grants ya son idempotentes, pero cortar
  // temprano evita trabajo y un asiento manual duplicado).
  if (alreadyApproved || purchase.status === 'active') return

  await activatePackagePurchaseInTx(tx, purchase, { requestId: purchase.id, paymentId: payment.id, createdByUserId })
}

async function recalcBookingFromPayments(tx: Prisma.TransactionClient, bookingId: string): Promise<{ booking: { id: string; status: string; businessId: string; customerId: string; totalPrice: number; depositRequired: number; depositPaid: number; remainingBalance: number; finalAmount: number; paymentStatus: string }; wasConfirmed: boolean }> {
  const booking = await tx.booking.findUnique({
    where: { id: bookingId },
  })
  if (!booking) throw new Error('Reserva no encontrada')

  const approvedPayments = await tx.payment.findMany({
    where: { bookingId, status: 'approved' },
  })

  // Net out money-out payments (refunds). Amounts are stored as positive
  // integers regardless of direction, so a refund must subtract — otherwise it
  // inflates depositPaid and can wrongly flip the booking to deposit_paid/
  // fully_paid after a refund was issued.
  const totalApproved = approvedPayments.reduce((sum, p) => {
    const sign = mapPaymentTypeToLedgerDirection(p.paymentType) === 'expense' ? -1 : 1
    return sum + sign * p.amount
  }, 0)
  const newDepositPaid = Math.max(0, totalApproved)
  const newRemainingBalance = Math.max(0, booking.finalAmount - newDepositPaid)

  let newPaymentStatus: BookingPaymentStatus
  if (totalApproved >= booking.finalAmount) {
    newPaymentStatus = BookingPaymentStatus.fully_paid
  } else if (totalApproved >= booking.depositRequired) {
    newPaymentStatus = BookingPaymentStatus.deposit_paid
  } else {
    newPaymentStatus = BookingPaymentStatus.unpaid
  }

  const shouldConfirm =
    booking.status === BookingStatus.pending_payment &&
    totalApproved >= booking.depositRequired

  if (shouldConfirm) {
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
      }
    }

    // Another tx already confirmed this booking. Refetch and recalc without status change.
    const refetched = await tx.booking.findUnique({ where: { id: bookingId } })
    if (!refetched) throw new Error('Reserva no encontrada')

    const updated = await tx.booking.update({
      where: { id: bookingId },
      data: {
        depositPaid: newDepositPaid,
        remainingBalance: newRemainingBalance,
        paymentStatus: newPaymentStatus,
      },
    })

    return { booking: updated, wasConfirmed: false }
  }

  // No confirmation needed — just update payment fields
  const updated = await tx.booking.update({
    where: { id: bookingId },
    data: {
      depositPaid: newDepositPaid,
      remainingBalance: newRemainingBalance,
      paymentStatus: newPaymentStatus,
    },
  })

  return { booking: updated, wasConfirmed: false }
}
