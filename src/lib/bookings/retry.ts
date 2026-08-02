import type { Booking } from '@prisma/client'
import { BookingStatus } from '@prisma/client'
import { addMinutes } from 'date-fns'
import { prisma } from '@/lib/db'
import { assertSlotFreeOfConflicts } from '@/lib/availability/validation'
import { RELEASED_STATUSES } from '@/lib/bookings/approval'
import type { ProfessionalPick } from '@/lib/professionals/eligible'
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
 * guards de abajo son en memoria, y los casos que no renuevan nada (otro
 * horario, hora pasada, ya confirmada) no pagan el advisory lock.
 *
 * Devuelve `null` cuando la reserva guardada ya no está en pie: en ese caso le
 * suelta la key y el caller sigue al camino de creación normal.
 */
export async function resumeBookingForRetry<T extends Booking>(
  existing: T,
  ctx: {
    serviceId: string
    startDateTime: Date
    professional: ProfessionalPick
    promotionCode?: string
    timezone: string
    holdMinutes: number
  },
): Promise<T | null> {
  // La key identifica UN intento. Si lo que se pide ahora no es lo que quedó
  // guardado, la clienta volvió atrás y cambió de horario, de servicio o de
  // persona: devolver la vieja sería cobrarle por una cita que ya no eligió. El
  // wizard suelta la key en esos tres casos, así que desde nuestra UI esto no
  // pasa; es el fail-closed para cualquier otro cliente.
  //
  // La persona entró en la lista cuando el funnel empezó a preguntarla: sin ella,
  // dos intentos con la misma key y distinto barbero devolvían el primero, y la
  // clienta pagaba por una hora con quien no eligió.
  //
  // **`anyone` no compara nada, y no es un agujero**: quien pidió "cualquiera" no
  // eligió a nadie en particular, así que la persona que el primer intento asignó
  // cumple igual lo que se está pidiendo ahora. Compararla contra `null` rechazaría
  // todos los reintentos legítimos de ese camino, y volver a resolver movería la
  // reserva a otra persona por nada.
  const personaCambio =
    ctx.professional.kind !== 'anyone' &&
    existing.professionalId !== (ctx.professional.kind === 'person' ? ctx.professional.id : null)

  if (
    existing.serviceId !== ctx.serviceId ||
    existing.startDateTime.getTime() !== ctx.startDateTime.getTime() ||
    personaCambio
  ) {
    throw volverAElegir('Esa reserva es de otro horario.')
  }

  // Ya no está en pie: la key no protege nada —una reserva muerta no se puede
  // duplicar— y quedarse con ella era el callejón sin salida que este fix vino a
  // cerrar. Se libera y el caller reserva de nuevo. Sacarla de `expired` NO es
  // revivirla: la vieja se queda muerta, esto crea una reserva nueva.
  if ((RELEASED_STATUSES as readonly string[]).includes(existing.status)) {
    await prisma.booking.update({ where: { id: existing.id }, data: { idempotencyKey: null } })
    return null
  }

  // `confirmed`, `completed` y `pending_confirmation` no esperan plata de este
  // camino: son reenvíos legítimos y se devuelven tal cual, sin tocar el hold ni
  // mirar el descuento (a alguien que ya pagó no se le dice "volvé a elegir").
  if (existing.status !== BookingStatus.pending_payment) return existing

  if (existing.startDateTime <= new Date()) {
    throw volverAElegir('Esa hora ya pasó.')
  }

  // El descuento también es parte del intento: aplicar un cupón DESPUÉS de que la
  // reserva se creó y reintentar devolvía la reserva sin descuento mientras la
  // pantalla mostraba el precio rebajado.
  //
  // El 0 solo no alcanza para decir que el cupón no se aplicó: un código válido
  // puede valer 0 (`rewardValue` admite 0, y un porcentaje chico se va a 0 por el
  // `Math.floor` de `computeDiscount`), y rechazar ESE reintento sería romper uno
  // legítimo. Lo que decide es si quedó canje: `applyPromotionInTx` inserta un
  // `PromotionRedemption` siempre que acepta el código, valga lo que valga.
  //
  // NO cubre todo el input —modalidad, dirección, datos de contacto—: la forma
  // completa de cerrarlo es derivar la key del contenido del intento, y eso es
  // un PR aparte.
  if (ctx.promotionCode && existing.discountAmount === 0) {
    const canje = await prisma.promotionRedemption.findFirst({
      where: { bookingId: existing.id },
      select: { id: true },
    })
    if (!canje) throw volverAElegir('Ese descuento no estaba en la reserva que empezaste.')
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
