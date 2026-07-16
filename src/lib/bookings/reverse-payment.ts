import type { Prisma } from '@prisma/client'
import { BookingPaymentStatus, PaymentStatus } from '@prisma/client'
import { clawbackLoyaltyForBooking } from '@/lib/loyalty/clawback'
import { recalcBookingFromPayments } from '@/server/services/finance'

export interface ReverseBookingPaymentOptions {
  paymentId: string
  bookingId: string
  businessId: string
  customerId: string | null
  /** monto completo del pago según MP (transaction_amount). */
  amount: number
  currency: string
  /** 'chargeback' = disputa (alarma fuera de acá); 'voluntary' = refund desde el panel de MP. */
  mode: 'chargeback' | 'voluntary'
  now: Date
  /** trazabilidad del webhook en el flip (providerPaymentId / rawPayload). */
  flipData?: { providerPaymentId?: string; rawPayload?: Prisma.InputJsonValue }
}

export interface ReverseBookingPaymentResult { reversed: boolean }

/**
 * Núcleo de reversión de un pago APROBADO de reserva (chargeback/refund que
 * llega por webhook MP post-approved). Espejo de reversePackagePurchaseInTx,
 * pero acá la unidad de idempotencia es el Payment: el flip `approved→refunded`
 * es atómico (updateMany where status:'approved'); sólo el llamador que gana el
 * flip asienta, recalcula y hace clawback — redeliveries y carreras son no-ops.
 *
 * Política (spec §1): la reserva NO cambia de status (la dueña decide qué hacer)
 * y la redención de promo NO se libera (la reserva sigue viva con su descuento;
 * si la dueña cancela después, cancelBookingInTx la libera). Los montos SÍ se
 * restauran vía recalc (depositPaid baja, remainingBalance sube → recobrable)
 * con paymentStatus overrideado a 'refunded' como marcador de la disputa.
 * El asiento refund_issued va con paymentId:null (el @@unique([paymentId]) ya
 * lo consume el asiento original del pago).
 */
export async function reverseBookingPaymentInTx(
  tx: Prisma.TransactionClient,
  opts: ReverseBookingPaymentOptions,
): Promise<ReverseBookingPaymentResult> {
  const flip = await tx.payment.updateMany({
    where: { id: opts.paymentId, status: PaymentStatus.approved },
    // Prisma ignora campos undefined, así que el spread de flipData es seguro
    // cuando falta (reversión sin datos del webhook).
    data: { status: PaymentStatus.refunded, ...opts.flipData },
  })
  if (flip.count === 0) return { reversed: false } // eco / redelivery / carrera

  if (opts.amount > 0) {
    await tx.ledgerEntry.create({
      data: {
        businessId: opts.businessId,
        bookingId: opts.bookingId,
        paymentId: null,
        customerId: opts.customerId,
        type: 'refund_issued',
        direction: 'expense',
        amount: opts.amount,
        currency: opts.currency,
        description: opts.mode === 'chargeback' ? 'Contracargo de reserva' : 'Reembolso de reserva',
        occurredAt: opts.now,
      },
    })
  }

  // Montos verdaderos (el pago flipeado ya no cuenta) + marcador de disputa.
  await recalcBookingFromPayments(tx, opts.bookingId, {
    paymentStatusOverride: BookingPaymentStatus.refunded,
  })

  // Clawback de loyalty — idempotente; visit es no-op si nunca se completó.
  await clawbackLoyaltyForBooking(tx, {
    bookingId: opts.bookingId,
    businessId: opts.businessId,
    now: opts.now,
  })

  return { reversed: true }
}
