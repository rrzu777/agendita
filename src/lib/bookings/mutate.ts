import type { Prisma } from '@prisma/client'
import { BookingStatus } from '@prisma/client'
import { releaseRedemptionForBooking } from '@/lib/promotions/release'
import { declaredTransferPaymentWhere } from '@/lib/bank-transfer/declared'

type Tx = Prisma.TransactionClient

/** Core tx-aware de cancelación (SIN auth — el caller valida quién puede).
 *  Réplica exacta de la tx histórica de cancelBooking: flip + release de
 *  promo/paquete + cierre del Payment bt-declared pendiente (§6.4 transferencias). */
export async function cancelBookingInTx(
  tx: Tx,
  booking: { id: string; internalNotes: string | null },
  opts: { reason?: string },
): Promise<void> {
  await tx.booking.update({
    where: { id: booking.id },
    data: {
      status: BookingStatus.cancelled,
      internalNotes: opts.reason
        ? `${booking.internalNotes || ''}\n[CANCELADA: ${opts.reason}]`.trim()
        : booking.internalNotes,
    },
  })
  await releaseRedemptionForBooking(tx, booking.id, 'cancelled')
  await tx.payment.updateMany({
    where: { bookingId: booking.id, ...declaredTransferPaymentWhere },
    data: { status: 'cancelled' },
  })
}
