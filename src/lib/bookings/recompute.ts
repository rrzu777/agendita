import { addMinutes } from 'date-fns'
import { BookingStatus, BookingPaymentStatus } from '@prisma/client'
import { initialPublicBookingStatus, approvalHoldExpiresAt } from '@/lib/bookings/approval'
import { DEFAULT_HOLD_MINUTES } from '@/lib/bookings/hold'

/** Recomputa montos/estado de una reserva tras aplicar un descuento (código o paquete).
 *  Extraído de bookings.ts para reusarlo en ambos caminos. Devuelve el objeto `data`
 *  del booking.update. `now` inyectable para test. */
export function recomputeBookingAmountsAfterDiscount(args: {
  price: number; depositAmount: number; discountAmount: number; now?: Date
  /** Duración del hold si la reserva queda pending_payment. Default 15min;
   *  transferencia bancaria pasa su ventana larga (holdHours*60). */
  holdMinutes?: number
  /** Sólo el camino público: un descuento puede dejar el abono en 0 y con eso la
   *  reserva salta de pending_payment a auto-confirmada. Si el negocio pide
   *  confirmación manual, ese salto tiene que caer en pending_confirmation, no en
   *  confirmed — sin esto un código de descuento saltea la aprobación. */
  approval?: { requireBookingApproval: boolean; startDateTime: Date }
}): {
  discountAmount: number; finalAmount: number; depositRequired: number; remainingBalance: number
  status: BookingStatus; holdExpiresAt: Date | null; paymentStatus: BookingPaymentStatus
} {
  const now = args.now ?? new Date()
  const discountedFinal = args.price - args.discountAmount
  const discountedDeposit = Math.min(args.depositAmount, discountedFinal)
  const free = discountedFinal <= 0
  const status = initialPublicBookingStatus({
    depositRequired: discountedDeposit,
    requireBookingApproval: args.approval?.requireBookingApproval ?? false,
  })
  return {
    discountAmount: args.discountAmount,
    finalAmount: discountedFinal,
    depositRequired: discountedDeposit,
    remainingBalance: discountedFinal,
    status,
    holdExpiresAt:
      status === BookingStatus.pending_payment ? addMinutes(now, args.holdMinutes ?? DEFAULT_HOLD_MINUTES)
      : status === BookingStatus.pending_confirmation && args.approval
        ? approvalHoldExpiresAt(args.approval.startDateTime, now)
        : null,
    paymentStatus: free ? BookingPaymentStatus.fully_paid : BookingPaymentStatus.unpaid,
  }
}
