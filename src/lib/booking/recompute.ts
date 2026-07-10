import { addMinutes } from 'date-fns'
import { BookingStatus, BookingPaymentStatus } from '@prisma/client'

/** Recomputa montos/estado de una reserva tras aplicar un descuento (código o paquete).
 *  Extraído de bookings.ts para reusarlo en ambos caminos. Devuelve el objeto `data`
 *  del booking.update. `now` inyectable para test. */
export function recomputeBookingAmountsAfterDiscount(args: {
  price: number; depositAmount: number; discountAmount: number; now?: Date
  /** Duración del hold si la reserva queda pending_payment. Default 15min;
   *  transferencia bancaria pasa su ventana larga (holdHours*60). */
  holdMinutes?: number
}): {
  discountAmount: number; finalAmount: number; depositRequired: number; remainingBalance: number
  status: BookingStatus; holdExpiresAt: Date | null; paymentStatus: BookingPaymentStatus
} {
  const now = args.now ?? new Date()
  const discountedFinal = args.price - args.discountAmount
  const discountedDeposit = Math.min(args.depositAmount, discountedFinal)
  const noDeposit = discountedDeposit <= 0
  const free = discountedFinal <= 0
  const status = noDeposit ? BookingStatus.confirmed : BookingStatus.pending_payment
  return {
    discountAmount: args.discountAmount,
    finalAmount: discountedFinal,
    depositRequired: discountedDeposit,
    remainingBalance: discountedFinal,
    status,
    holdExpiresAt: status === BookingStatus.pending_payment ? addMinutes(now, args.holdMinutes ?? 15) : null,
    paymentStatus: free ? BookingPaymentStatus.fully_paid : BookingPaymentStatus.unpaid,
  }
}
