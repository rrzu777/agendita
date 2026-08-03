import type { Prisma } from '@prisma/client'
import { BookingStatus } from '@prisma/client'
import { addMinutes } from 'date-fns'
import { formatBookingDateTime } from '@/lib/bookings/format-booking-datetime'
import { TERMINAL_BOOKING_STATUSES } from '@/lib/bookings/status-labels'
import { releaseRedemptionForBooking } from '@/lib/promotions/release'
import { anyDeclaredTransferWhere } from '@/lib/bank-transfer/declared'
import { assertProfessionalIsFree, assertSlotIsAvailable } from '@/lib/availability/validation'
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
    booking: { id: string; businessId: string; serviceId: string; startDateTime: Date; internalNotes: string | null; professionalId: string | null }
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
    // Reprogramar conserva a quien iba a atender: los slots que se ofrecieron son
    // los suyos y el chequeo tiene que ser contra los mismos.
    professionalId: booking.professionalId,
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
      status: { notIn: [...TERMINAL_BOOKING_STATUSES] },
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

/** Core tx-aware de REASIGNACIÓN (SIN auth): cambiarle la persona a una cita
 *  sin mover la hora — la operación de un martes cualquiera, cuando alguien
 *  avisa que está enfermo y sus citas del día pasan a otra persona.
 *
 *  Lo único a validar es que la persona NUEVA tenga ese horario libre — su
 *  regla del día, sus bloqueos más los del negocio, y las citas que le tapan
 *  la hora — excluyendo esta misma cita. La mitad "bookable" (lead time,
 *  ventana, servicio activo) se salta A PROPÓSITO: una cita ya pactada no se
 *  cae porque el catálogo cambió después, mismo criterio que revivir.
 *  `assertProfessionalIsFree` toma el advisory lock por negocio+día adentro,
 *  así que el resultado vale hasta el fin de la tx.
 *
 *  El caller autoriza antes (persona activa del negocio que hace ESTE servicio
 *  en ESTA modalidad, vía `assertProfessionalOffersService`) y trae los
 *  nombres: acá sólo se usan para la nota del historial. */
export async function reassignBookingInTx(
  tx: Tx,
  input: {
    booking: {
      id: string
      businessId: string
      serviceId: string
      startDateTime: Date
      endDateTime: Date
      internalNotes: string | null
      professionalId: string | null
    }
    newProfessionalId: string
    newProfessionalName: string
    previousProfessionalName: string | null
    timezone: string
  },
): Promise<void> {
  const { booking, newProfessionalId, newProfessionalName, previousProfessionalName, timezone } = input

  await assertProfessionalIsFree({
    tx,
    businessId: booking.businessId,
    serviceId: booking.serviceId,
    startDateTime: booking.startDateTime,
    endDateTime: booking.endDateTime,
    timezone,
    professionalId: newProfessionalId,
    excludeBookingId: booking.id,
  })

  // Asignar (de nadie a alguien) es la misma operación con nota distinta: una
  // reserva vieja sin persona también necesita dueña cuando aparece el equipo.
  const historyNote = previousProfessionalName
    ? `[REASIGNADA: de ${previousProfessionalName} a ${newProfessionalName}]`
    : `[ASIGNADA a ${newProfessionalName}]`
  const updateResult = await tx.booking.updateMany({
    where: {
      id: booking.id,
      businessId: booking.businessId,
      status: { notIn: [...TERMINAL_BOOKING_STATUSES] },
    },
    data: {
      professionalId: newProfessionalId,
      internalNotes: booking.internalNotes ? `${booking.internalNotes}\n${historyNote}` : historyNote,
    },
  })
  if (updateResult.count === 0) {
    throw new UserError('No se puede reasignar una reserva en este estado')
  }
}
