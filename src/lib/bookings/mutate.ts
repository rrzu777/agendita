import type { Prisma } from '@prisma/client'
import { BookingStatus, type BookingPaymentStatus } from '@prisma/client'
import { addMinutes } from 'date-fns'
import { formatBookingDateTime } from '@/lib/bookings/format-booking-datetime'
import { TERMINAL_BOOKING_STATUSES } from '@/lib/bookings/status-labels'
import { releaseRedemptionForBooking } from '@/lib/promotions/release'
import { anyDeclaredTransferWhere } from '@/lib/bank-transfer/declared'
import { assertProfessionalIsFree, assertSlotIsAvailable } from '@/lib/availability/validation'
import { rescheduleBlockedReason, type RescheduleAudience } from '@/lib/bookings/hold'
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
 *  leadTimeMinutes: dueña pasa 0 (la dueña manda); clienta omite (default del funnel).
 *
 *  `rescheduledBy` es REQUERIDO y no tiene default: acá se decide que una reserva
 *  condenada no se mueve, pero quién la está moviendo —y con eso qué salida
 *  nombrarle— sólo lo sabe el caller. Ver `rescheduleBlockedReason`. */
export async function rescheduleBookingInTx(
  tx: Tx,
  input: {
    booking: {
      id: string; businessId: string; serviceId: string; startDateTime: Date
      internalNotes: string | null; professionalId: string | null
      /** Los tres que decide `isDoomedHold`. Requeridos por el mismo motivo que
       *  en `assertBookingPayable`: sin ellos el guard no existe y la reserva se
       *  mueve para morirse igual. Con los enums de Prisma y no con `string`:
       *  al lado de `status` hay OTRO status (el del Payment) que encajaría sin
       *  chistar y apagaría el guard. */
      status: BookingStatus; paymentStatus: BookingPaymentStatus; holdExpiresAt: Date | null
    }
    newStartDateTime: Date
    durationMinutes: number
    timezone: string
    leadTimeMinutes?: number
    rescheduledBy: RescheduleAudience
  },
): Promise<{ endDateTime: Date }> {
  const { booking, newStartDateTime, durationMinutes, timezone, leadTimeMinutes, rescheduledBy } = input
  const endDateTime = addMinutes(newStartDateTime, durationMinutes)

  // Mover la cita no le devuelve la vida: acá abajo NO se escribe
  // `holdExpiresAt`, así que el cron la barre igual. Sin este guard la
  // reprogramación salía bien, avisaba a las dos partes, y después la reserva no
  // estaba.
  //
  // Corta el plazo YA VENCIDO, que es el que miente en la pantalla. NO cubre el
  // que vence dentro de un rato: ése sigue saliendo bien y muriéndose después, y
  // en `pending_confirmation` es peor que un descuido —`approvalHoldExpiresAt`
  // topa el plazo en el startDateTime VIEJO, así que mover la cita para adelante
  // deja un plazo que mata la solicitud antes de que la dueña haya tenido su
  // ventana—. Arreglarlo es recalcular el hold acá, y eso pide decidir política
  // de ventanas (`DEFAULT_HOLD_MINUTES` / `holdHours` / `manualHoldHours` /
  // `APPROVAL_WINDOW_HOURS`, ninguna de las cuales llega a esta función).
  const blockedReason = rescheduleBlockedReason(booking, rescheduledBy, new Date())
  if (blockedReason) {
    throw new UserError(blockedReason)
  }

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
