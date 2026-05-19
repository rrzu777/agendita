import type { Prisma } from '@prisma/client'
import { BookingStatus, BookingPaymentStatus, PaymentProvider, PaymentType } from '@prisma/client'
import { assertBookingPayable } from '@/lib/booking-payments'

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
}: ApplyApprovedPaymentInput) {
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

  assertBookingPayable(booking)

  let payment: { id: string; amount: number; status: string; provider: string; providerPaymentId: string | null } | null = null

  if (explicitPaymentId) {
    const found = await tx.payment.findUnique({
      where: { id: explicitPaymentId },
    })
    if (!found) {
      throw new Error('Pago no encontrado')
    }
    if (found.bookingId !== bookingId) {
      throw new Error('El pago no corresponde a esta reserva')
    }
    if (found.businessId !== businessId) {
      throw new Error('El pago no pertenece al negocio')
    }
    if (found.amount !== amount) {
      throw new Error('El monto no coincide con el pago registrado')
    }
    if (found.provider !== provider) {
      throw new Error('El proveedor no coincide con el pago registrado')
    }
    if (found.providerPaymentId !== providerPaymentId) {
      throw new Error('El providerPaymentId no coincide con el pago registrado')
    }
    payment = found
  } else if (providerPaymentId) {
    payment = await tx.payment.findFirst({
      where: {
        bookingId,
        provider,
        providerPaymentId,
      },
    })
  }
  // Si no hay explicitPaymentId ni providerPaymentId, nunca reutilizamos un Payment
  // existente (evita reutilizar pagos manuales previos del mismo booking).

  if (payment && payment.status === 'approved') {
    // Idempotencia: ya existe y está aprobado; solo recalcular y retornar
    return recalcBookingFromPayments(tx, bookingId)
  }

  if (payment) {
    payment = await tx.payment.update({
      where: { id: payment.id },
      data: {
        status: 'approved',
        paidAt: new Date(),
        ...(rawPayload !== undefined && { rawPayload }),
      },
    })
  } else {
    payment = await tx.payment.create({
      data: {
        businessId,
        bookingId,
        customerId: booking.customerId,
        provider,
        providerPaymentId,
        amount,
        currency,
        status: 'approved',
        paymentType,
        paymentMethod: paymentMethod ?? null,
        paidAt: new Date(),
        ...(rawPayload !== undefined && { rawPayload }),
      },
    })
  }

  const existingLedger = await tx.ledgerEntry.findFirst({
    where: { paymentId: payment.id },
  })

  if (!existingLedger) {
    const approvedPayments = await tx.payment.findMany({
      where: { bookingId, status: 'approved' },
    })
    const totalApproved = approvedPayments.reduce((sum, p) => sum + p.amount, 0)
    const isFullPayment = totalApproved >= booking.finalAmount

    await tx.ledgerEntry.create({
      data: {
        businessId,
        bookingId,
        paymentId: payment.id,
        customerId: booking.customerId,
        type: isFullPayment ? 'full_payment_paid' : 'deposit_paid',
        direction: 'income',
        amount: payment.amount,
        currency,
        description: `${isFullPayment ? 'Pago total' : 'Abono'} para reserva ${booking.id.slice(-4)}`,
        occurredAt: new Date(),
        createdByUserId: createdByUserId ?? null,
      },
    })
  }

  return recalcBookingFromPayments(tx, bookingId)
}

async function recalcBookingFromPayments(tx: Prisma.TransactionClient, bookingId: string) {
  const booking = await tx.booking.findUnique({
    where: { id: bookingId },
  })
  if (!booking) throw new Error('Reserva no encontrada')

  const approvedPayments = await tx.payment.findMany({
    where: { bookingId, status: 'approved' },
  })

  const totalApproved = approvedPayments.reduce((sum, p) => sum + p.amount, 0)
  const newDepositPaid = totalApproved
  const newRemainingBalance = Math.max(0, booking.finalAmount - totalApproved)

  let newPaymentStatus: BookingPaymentStatus
  let newStatus: BookingStatus = booking.status

  if (totalApproved >= booking.finalAmount) {
    newPaymentStatus = BookingPaymentStatus.fully_paid
  } else if (totalApproved >= booking.depositRequired) {
    newPaymentStatus = BookingPaymentStatus.deposit_paid
  } else {
    newPaymentStatus = BookingPaymentStatus.unpaid
  }

  if (
    booking.status === BookingStatus.pending_payment &&
    totalApproved >= booking.depositRequired
  ) {
    newStatus = BookingStatus.confirmed
  }

  const updated = await tx.booking.update({
    where: { id: bookingId },
    data: {
      depositPaid: newDepositPaid,
      remainingBalance: newRemainingBalance,
      paymentStatus: newPaymentStatus,
      status: newStatus,
    },
  })

  return updated
}
