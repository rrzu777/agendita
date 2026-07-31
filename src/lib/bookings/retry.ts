import type { Booking } from '@prisma/client'
import { BookingStatus } from '@prisma/client'
import { addMinutes } from 'date-fns'
import { prisma } from '@/lib/db'
import { assertSlotFreeOfConflicts } from '@/lib/availability/validation'
import { RELEASED_STATUSES } from '@/lib/bookings/approval'
import { UserError } from '@/lib/actions/result'

/** Los tres mensajes comparten cola: el único camino de vuelta es el paso de la
 *  hora, que es donde el wizard suelta la key y empieza un intento nuevo. */
function volverAElegir(motivo: string): UserError {
  return new UserError(`${motivo} Vuelve a elegir la hora para reservar de nuevo.`)
}

/**
 * Segundo (o tercer) envío con la MISMA idempotencyKey: la clienta apretó
 * "Intentar de nuevo" tras un error, o volvió del checkout y re-envió.
 *
 * Devolver la reserva guardada tal cual —lo que se hacía antes— era mandarla a
 * pagar a ciegas: entre el primer intento y este, el horario pudo habérselo
 * llevado otra reserva o un bloqueo de la dueña, y el hold pudo vencer. Lo
 * primero terminaba en un cobro real por un horario ajeno (la pantalla de
 * retorno de MP recién lo dice desde el fix de `paid_unconfirmed`); lo segundo,
 * en un callejón sin salida — `initiatePayment` rechaza el hold vencido y el
 * botón de reintentar reusa la misma key, así que el error se repite para
 * siempre.
 *
 * Recibe la reserva ya leída y NO abre transacción hasta que hace falta: los
 * cuatro guards de abajo son en memoria, y los casos muertos (otro horario,
 * cancelada, hora pasada, ya confirmada) no pagan el advisory lock.
 */
export async function resumeBookingForRetry<T extends Booking>(
  existing: T,
  ctx: {
    serviceId: string
    startDateTime: Date
    promotionCode?: string
    timezone: string
    holdMinutes: number
  },
): Promise<T> {
  // La key identifica UN intento. Si lo que se pide ahora no es lo que quedó
  // guardado, la clienta volvió atrás y cambió de horario (o de servicio):
  // devolver la vieja sería cobrarle por una hora que ya no eligió. El wizard
  // suelta la key al elegir horario, así que desde nuestra UI esto no pasa; es
  // el fail-closed para cualquier otro cliente.
  if (
    existing.serviceId !== ctx.serviceId ||
    existing.startDateTime.getTime() !== ctx.startDateTime.getTime()
  ) {
    throw volverAElegir('Esa reserva es de otro horario.')
  }

  // El descuento también es parte del intento: aplicar un cupón DESPUÉS de que la
  // reserva se creó y reintentar devolvía la reserva sin descuento mientras la
  // pantalla mostraba el precio rebajado. Un código aceptado siempre deja
  // `discountAmount > 0` (`applyPromotionInTx` lanza y hace rollback si no vale),
  // así que un 0 acá significa que este cupón no estuvo en el intento guardado.
  // NO cubre todo el input —modalidad, dirección, datos de contacto—: la forma
  // completa de cerrarlo es derivar la key del contenido del intento, y eso es
  // un PR aparte.
  if (ctx.promotionCode && existing.discountAmount === 0) {
    throw volverAElegir('Ese descuento no estaba en la reserva que empezaste.')
  }

  if ((RELEASED_STATUSES as readonly string[]).includes(existing.status)) {
    throw volverAElegir('Esa reserva ya no está vigente.')
  }

  // `confirmed`, `completed` y `pending_confirmation` no esperan plata de este
  // camino: son reenvíos legítimos y se devuelven tal cual, sin tocar el hold.
  if (existing.status !== BookingStatus.pending_payment) return existing

  if (existing.startDateTime <= new Date()) {
    throw volverAElegir('Esa hora ya pasó.')
  }

  // Nunca ACORTAR el hold: si el primer intento fue por transferencia (ventana
  // de 24h) y este viene por Mercado Pago, recalcular a secas le comería 23
  // horas y media de plazo a una reserva que ya las tenía.
  const renovado = addMinutes(new Date(), ctx.holdMinutes)
  const holdExpiresAt =
    existing.holdExpiresAt && existing.holdExpiresAt > renovado ? existing.holdExpiresAt : renovado

  await prisma.$transaction(async (tx) => {
    // `assertSlotFreeOfConflicts` y no el assert completo: acá el horario ya está
    // pactado y lo que importa es que nadie más se lo haya llevado, no re-validar
    // el catálogo (mismo criterio que `reviveBooking`). Ojo: eso todavía no es
    // cierto de punta a punta — el `resolveBookingDraft` del caller exige el
    // servicio activo y rebota antes de llegar acá.
    await assertSlotFreeOfConflicts({
      tx,
      businessId: existing.businessId,
      startDateTime: existing.startDateTime,
      endDateTime: existing.endDateTime,
      timezone: ctx.timezone,
      professionalId: existing.professionalId,
      excludeBookingId: existing.id,
    })
    // Guardado por status, como los otros cores tx-aware (`cancelBookingInTx`,
    // `rescheduleBookingInTx`, `declareBankTransfer`): la reserva se leyó FUERA
    // de esta tx, así que el cron de holds pudo marcarla `expired` en el medio y
    // un update pelado le escribiría un hold fresco a una reserva muerta.
    const { count } = await tx.booking.updateMany({
      where: { id: existing.id, status: BookingStatus.pending_payment },
      data: { holdExpiresAt },
    })
    if (count === 0) throw volverAElegir('Esa reserva ya no está vigente.')
  })

  return { ...existing, holdExpiresAt }
}
