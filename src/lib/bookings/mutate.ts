import type { Prisma } from '@prisma/client'
import { BookingStatus } from '@prisma/client'
import { addMinutes } from 'date-fns'
import { releaseRedemptionForBooking } from '@/lib/promotions/release'
import { declaredTransferPaymentWhere } from '@/lib/bank-transfer/declared'
import { assertSlotIsAvailable } from '@/lib/availability/validation'

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

/** Core tx-aware de reprogramación (SIN auth). assertSlotIsAvailable cubre
 *  bloqueos (getEffectiveBlocks) + anti-doble-booking; el updateMany guardado
 *  por status evita la carrera con complete/cancel concurrente.
 *  leadTimeMinutes: dueña pasa 0 (la dueña manda); clienta omite (default del funnel). */
export async function rescheduleBookingInTx(
  tx: Tx,
  input: {
    booking: { id: string; businessId: string; serviceId: string; startDateTime: Date; internalNotes: string | null }
    newStartDateTime: Date
    durationMinutes: number
    timezone: string
    leadTimeMinutes?: number
  },
): Promise<{ endDateTime: Date }> {
  const { booking, newStartDateTime, durationMinutes, timezone, leadTimeMinutes } = input
  const endDateTime = addMinutes(newStartDateTime, durationMinutes)

  await assertSlotIsAvailable({
    tx,
    businessId: booking.businessId,
    serviceId: booking.serviceId,
    startDateTime: newStartDateTime,
    endDateTime,
    timezone,
    excludeBookingId: booking.id,
    ...(leadTimeMinutes !== undefined ? { leadTimeMinutes } : {}),
  })

  const historyNote = `[REPROGRAMADA de ${booking.startDateTime.toLocaleString('es-CL')}]`
  const updateResult = await tx.booking.updateMany({
    where: {
      id: booking.id,
      businessId: booking.businessId,
      status: { notIn: [BookingStatus.completed, BookingStatus.cancelled, BookingStatus.no_show, BookingStatus.expired] },
    },
    data: {
      startDateTime: newStartDateTime,
      endDateTime,
      internalNotes: booking.internalNotes ? `${booking.internalNotes}\n${historyNote}` : historyNote,
    },
  })
  if (updateResult.count === 0) {
    throw new Error('No se puede reprogramar una reserva en este estado')
  }
  return { endDateTime }
}
