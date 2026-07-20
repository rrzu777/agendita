import type { Prisma } from '@prisma/client'
import { BookingStatus } from '@prisma/client'
import { addMinutes } from 'date-fns'
import { formatBookingDateTime } from '@/lib/booking/format-booking-datetime'
import { releaseRedemptionForBooking } from '@/lib/promotions/release'
import { anyDeclaredTransferWhere } from '@/lib/bank-transfer/declared'
import { assertSlotIsAvailable } from '@/lib/availability/validation'
// UserError: estos mensajes son user-facing y deben sobrevivir al wrapper
// action(); para callers sin wrapper (bookings.ts dueña) es un Error normal
// (extends Error).
import { UserError } from '@/lib/actions/result'

type Tx = Prisma.TransactionClient

/** Core tx-aware de cancelación (SIN auth — el caller valida quién puede).
 *  Réplica de la tx histórica de cancelBooking (flip + release de promo/paquete
 *  + cierre del Payment bt-declared pendiente, §6.4) con el update guardado por
 *  status: los mismos estados que el guard pre-tx de la dueña (completed y
 *  cancelled no se cancelan), pero DENTRO de la tx para cerrar la carrera con
 *  un complete concurrente — importa más ahora que la clienta también cancela. */
export async function cancelBookingInTx(
  tx: Tx,
  booking: { id: string; internalNotes: string | null },
  opts: { reason?: string },
): Promise<void> {
  const updateResult = await tx.booking.updateMany({
    where: {
      id: booking.id,
      status: { notIn: [BookingStatus.completed, BookingStatus.cancelled] },
    },
    data: {
      status: BookingStatus.cancelled,
      internalNotes: opts.reason
        ? `${booking.internalNotes || ''}\n[CANCELADA: ${opts.reason}]`.trim()
        : booking.internalNotes,
    },
  })
  if (updateResult.count === 0) {
    throw new UserError('No se puede cancelar una reserva en este estado')
  }
  await releaseRedemptionForBooking(tx, booking.id, 'cancelled')
  // abono Y saldo: cancelar una reserva mata cualquier declaración pendiente.
  await tx.payment.updateMany({
    where: { bookingId: booking.id, ...anyDeclaredTransferWhere },
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

  // Fecha en la TZ del negocio (no la del server): con UTC en Vercel una hora local
  // nocturna quedaba anotada con el día equivocado.
  const historyNote = `[REPROGRAMADA de ${formatBookingDateTime(booking.startDateTime, timezone)}]`
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
    throw new UserError('No se puede reprogramar una reserva en este estado')
  }
  return { endDateTime }
}
