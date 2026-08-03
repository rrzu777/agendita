import { prisma } from '@/lib/db'
import { BookingStatus, type Prisma, type PrismaClient } from '@prisma/client'
import { releaseRedemptionsOfExpiredBookings } from '@/lib/promotions/release'
import { declaredTransferPaymentWhere, declaredPkgTransferPaymentWhere } from '@/lib/bank-transfer/declared'
import {
  sendNotificationSafely,
  sendBankTransferExpiredToCustomer,
  sendManualHoldExpiredToCustomer,
  sendBookingCancelledNotification,
  getBusinessReplyToEmail,
} from '@/lib/notifications'
import { MANUAL_COORDINATION_METHOD } from '@/lib/bookings/hold'

export interface ExpireHoldsResult {
  expired: number
  businessIds: string[]
  declaredTransferExpired: number
  packagesExpired: number
  /** Solicitudes que el negocio no respondió dentro de la ventana de aprobación. */
  requestsExpired: number
}

interface ExpireHoldsDeps {
  sendExpiredEmail: typeof sendBankTransferExpiredToCustomer
  sendManualExpiredEmail: typeof sendManualHoldExpiredToCustomer
  sendCancelledEmail: typeof sendBookingCancelledNotification
}

/** Motivo que ve la clienta cuando el negocio dejó vencer su solicitud. */
const UNANSWERED_REASON = 'El negocio no alcanzó a confirmar la reserva a tiempo'

/**
 * Aviso best-effort a las clientas de un lote de reservas expiradas: carga las
 * filas, resuelve un reply-to por negocio (cacheado entre lotes de la misma
 * corrida) y dispara los mails en paralelo. Los dos mails de expiración
 * (transferencia declarada y coordinación manual) comparten el payload, así
 * que el armado vive una sola vez acá.
 */
async function notifyExpiredCustomers(
  db: Pick<PrismaClient, 'booking'>,
  args: {
    where: Prisma.BookingWhereInput
    label: string
    send: typeof sendBankTransferExpiredToCustomer
    replyToCache: Map<string, string | null>
  },
): Promise<void> {
  const toNotify = await db.booking.findMany({
    where: args.where,
    include: { customer: true, service: true, business: true },
  })
  if (toNotify.length === 0) return

  await Promise.all(
    [...new Set(toNotify.map((b) => b.businessId))]
      .filter((bizId) => !args.replyToCache.has(bizId))
      .map(async (bizId) => {
        args.replyToCache.set(bizId, await getBusinessReplyToEmail(bizId))
      }),
  )
  await Promise.all(
    toNotify
      .filter((b) => b.customer?.email)
      .map((b) =>
        sendNotificationSafely(args.label, () =>
          args.send({
            businessName: b.business.name,
            businessTimezone: b.business.timezone || 'America/Santiago',
            businessReplyToEmail: args.replyToCache.get(b.businessId) ?? null,
            customerName: b.customer!.name,
            customerEmail: b.customer!.email!,
            serviceName: b.service?.name ?? 'servicio',
            startDateTime: b.startDateTime,
            bookingNumber: b.bookingNumber,
          }),
        ),
      ),
  )
}

/**
 * Expira las solicitudes (`pending_confirmation`) que nadie respondió antes de
 * `holdExpiresAt`, libera sus canjes y avisa a la clienta.
 *
 * A diferencia del sweep de holds de pago, NO filtra por `paymentStatus`: una
 * solicitud sobre un servicio gratis nace `fully_paid`, y filtrar por `unpaid`
 * la dejaría colgada para siempre ocupando el cupo.
 */
async function expireUnansweredRequests(
  now: Date,
  db: Pick<PrismaClient, 'booking' | '$transaction'>,
  deps: ExpireHoldsDeps,
): Promise<{ count: number; businessIds: string[] }> {
  const candidates = await db.booking.findMany({
    where: {
      status: BookingStatus.pending_confirmation,
      holdExpiresAt: { lt: now },
    },
    select: { id: true, businessId: true },
  })
  if (candidates.length === 0) return { count: 0, businessIds: [] }

  const ids = candidates.map((b) => b.id)
  const count = await db.$transaction(async (tx) => {
    const res = await tx.booking.updateMany({
      // Repetir las condiciones dentro de la tx: una aprobación que entra entre
      // el findMany y este update no debe expirarse (mismo patrón que el sweep
      // de holds de pago).
      where: { id: { in: ids }, status: BookingStatus.pending_confirmation, holdExpiresAt: { lt: now } },
      data: { status: BookingStatus.expired },
    })
    await releaseRedemptionsOfExpiredBookings(tx, ids)
    return res.count
  })

  // Aviso best-effort a la clienta (post-tx). Sin esto se queda esperando una
  // respuesta que ya no va a llegar, y el cupo se liberó sin que se entere.
  const toNotify = await db.booking.findMany({
    where: { id: { in: ids }, status: BookingStatus.expired },
    include: { customer: true, service: true, business: true },
  })
  const replyToByBiz = new Map<string, string | null>()
  await Promise.all(
    [...new Set(toNotify.map((b) => b.businessId))].map(async (bizId) => {
      replyToByBiz.set(bizId, await getBusinessReplyToEmail(bizId))
    }),
  )
  await Promise.all(
    toNotify
      .filter((b) => b.customer?.email)
      .map((b) =>
        sendNotificationSafely('booking request expired', () =>
          deps.sendCancelledEmail({
            businessName: b.business.name,
            businessReplyToEmail: replyToByBiz.get(b.businessId) ?? null,
            customerName: b.customer!.name,
            customerEmail: b.customer!.email!,
            serviceName: b.service?.name ?? 'servicio',
            startDateTime: b.startDateTime,
            businessTimezone: b.business.timezone || 'America/Santiago',
            reason: UNANSWERED_REASON,
            // Una solicitud nunca estuvo confirmada: no se le mandó `.ics`,
            // no hay evento que borrar.
            calendar: null,
          }),
        ),
      ),
  )

  return { count, businessIds: [...new Set(candidates.map((b) => b.businessId))] }
}

/**
 * Expira transaccionalmente reservas pending_payment cuyo hold haya vencido.
 * El updateMany repite las condiciones de findMany para evitar races
 * con pagos que entren entre la búsqueda y la actualización.
 *
 * Reparto con `sweepStaleHoldsInTx` (lib/bookings/sweep-stale-holds.ts), que barre
 * lo mismo pero en el momento en que alguien intenta reservar el horario: ése se
 * queda sólo con los abandonos silenciosos, y este cron con TODO lo vencido —
 * incluida la transferencia ya declarada — porque es el único que puede mandarle
 * el mail a la clienta antes de sacarle la hora.
 */
export async function expireStaleHolds(
  now = new Date(),
  db: Pick<PrismaClient, 'booking' | 'payment' | '$transaction' | 'packagePurchase'> = prisma,
  deps: ExpireHoldsDeps = {
    sendExpiredEmail: sendBankTransferExpiredToCustomer,
    sendManualExpiredEmail: sendManualHoldExpiredToCustomer,
    sendCancelledEmail: sendBookingCancelledNotification,
  }
): Promise<ExpireHoldsResult> {
  // ── Sweep de compras de paquete pending con hold vencido (B4b-3) ──
  // Corre SIEMPRE, antes del early-return de reservas (el caso común es 0 reservas
  // vencidas; si el sweep fuera después del return, nunca correría).
  // Sólo barre compras ABANDONADAS (nunca se declaró la transferencia). Si la
  // clienta ya declaró "ya transferí" (existe un Payment bt-pkg-declared pending),
  // NO se expira: la plata pudo haberse enviado, así que queda pendiente de que la
  // dueña confirme/rechace (un paquete no bloquea cupo, no hay urgencia de expirar).
  const expiredPurchases = await db.packagePurchase.findMany({
    where: {
      status: 'pending',
      holdExpiresAt: { lt: now },
      payments: { none: declaredPkgTransferPaymentWhere },
    },
    select: { id: true, businessId: true },
  })
  let packagesExpired = 0
  const packageBusinessIds: string[] = []
  if (expiredPurchases.length > 0) {
    const pkgIds = expiredPurchases.map((p) => p.id)
    await db.$transaction(async (tx) => {
      const res = await tx.packagePurchase.updateMany({
        where: {
          id: { in: pkgIds },
          status: 'pending',
          holdExpiresAt: { lt: now },
          // Repetir TAMBIÉN el filtro de declaradas (como hace el sweep de reservas
          // con sus condiciones): una declaración que entra entre el findMany y este
          // update no debe expirarse — sin esto, el update la barría y el cancel de
          // abajo mataba su Payment recién creado (carrera declare↔sweep).
          payments: { none: declaredPkgTransferPaymentWhere },
        },
        data: { status: 'expired' },
      })
      packagesExpired = res.count
      // Cancelar los Payment pending huérfanos de las compras que REALMENTE expiraron
      // (filtro por la relación en la misma tx — status ya es 'expired' acá).
      await tx.payment.updateMany({
        where: { packagePurchaseId: { in: pkgIds }, status: 'pending', packagePurchase: { status: 'expired' } },
        data: { status: 'cancelled' },
      })
    })
    packageBusinessIds.push(...new Set(expiredPurchases.map((p) => p.businessId)))
  }

  // ── Sweep de solicitudes sin responder (confirmación manual) ──
  // Igual que el de paquetes: corre SIEMPRE, antes del early-return de reservas.
  const requests = await expireUnansweredRequests(now, db, deps)

  const expiredBookings = await db.booking.findMany({
    where: {
      status: BookingStatus.pending_payment,
      holdExpiresAt: { lt: now },
      paymentStatus: 'unpaid',
    },
    // paymentMethod: para saltear la query de avisos manuales cuando ningún
    // candidato es de coordinación manual (hoy, casi todas las corridas).
    select: { id: true, businessId: true, paymentMethod: true },
  })

  if (expiredBookings.length === 0) {
    return {
      expired: 0,
      businessIds: [...new Set([...packageBusinessIds, ...requests.businessIds])],
      declaredTransferExpired: 0,
      packagesExpired,
      requestsExpired: requests.count,
    }
  }

  const expiredIds = expiredBookings.map((b) => b.id)

  const { count, declaredBookingIds } = await db.$transaction(async (tx) => {
    const res = await tx.booking.updateMany({
      where: {
        id: { in: expiredIds },
        status: BookingStatus.pending_payment,
        paymentStatus: 'unpaid',
        holdExpiresAt: { lt: now },
      },
      data: {
        status: BookingStatus.expired,
      },
    })
    await releaseRedemptionsOfExpiredBookings(tx, expiredIds)

    // Cerrar el Payment declarado huérfano (bt-declared) de las reservas que
    // REALMENTE transicionaron a `expired` en esta corrida — filtrando por la
    // relación booking.status en la misma query, sin un findMany intermedio.
    // (Filtro por relación en `where` es seguro; el landmine es relationLoadStrategy:'join'.)
    // Sin esto el Payment queda `pending` para siempre.
    const declaredPayments = await tx.payment.findMany({
      where: {
        bookingId: { in: expiredIds },
        booking: { status: BookingStatus.expired },
        ...declaredTransferPaymentWhere,
      },
      select: { bookingId: true },
    })
    const declaredBookingIds = declaredPayments
      .map((p) => p.bookingId)
      .filter((id): id is string => id !== null)
    if (declaredBookingIds.length > 0) {
      await tx.payment.updateMany({
        where: { bookingId: { in: declaredBookingIds }, ...declaredTransferPaymentWhere },
        data: { status: 'cancelled' },
      })
    }
    return { count: res.count, declaredBookingIds }
  })

  // Emails best-effort post-tx, ambos por el mismo helper (un reply-to por
  // negocio, compartido entre lotes; los envíos en paralelo y tragándose sus
  // errores vía sendNotificationSafely):
  //
  // - Transferencias declaradas expiradas: la clienta dijo "ya transferí" y la
  //   plata pudo haber salido — el mail le dice qué hacer.
  // - Coordinación manual expirada: acá la clienta no abandonó un checkout — el
  //   negocio no confirmó el abono dentro de la ventana. Sin el aviso se queda
  //   esperando un contacto que ya no va a llegar. (El sweep de MP sigue
  //   silencioso a propósito: esa clienta cerró el checkout sabiendo los 15
  //   minutos.)
  const replyToCache = new Map<string, string | null>()
  if (declaredBookingIds.length > 0) {
    await notifyExpiredCustomers(db, {
      where: { id: { in: declaredBookingIds } },
      label: 'bank transfer expired',
      send: deps.sendExpiredEmail,
      replyToCache,
    })
  }
  // El if evita una query con tres joins por corrida cuando ningún candidato
  // era de coordinación manual; el where de adentro re-verifica contra la fila
  // real (status expired) para no avisarle a quien ganó la carrera del pago.
  if (expiredBookings.some((b) => b.paymentMethod === MANUAL_COORDINATION_METHOD)) {
    await notifyExpiredCustomers(db, {
      where: {
        id: { in: expiredIds },
        status: BookingStatus.expired,
        paymentMethod: MANUAL_COORDINATION_METHOD,
      },
      label: 'manual hold expired',
      send: deps.sendManualExpiredEmail,
      replyToCache,
    })
  }

  // Solo revalidar los negocios cuyas reservas REALMENTE se actualizaron.
  // Como no podemos saber cuáles IDs se actualizaron sin query adicional,
  // usamos el count. Si el count difiere del length, significa que hubo races.
  // En ese caso revalidamos todos los candidatos (conservador pero correcto).
  const businessIds = [
    ...new Set([
      ...expiredBookings.map((b) => b.businessId),
      ...packageBusinessIds,
      ...requests.businessIds,
    ]),
  ]

  return {
    expired: count,
    businessIds,
    declaredTransferExpired: declaredBookingIds.length,
    packagesExpired,
    requestsExpired: requests.count,
  }
}
