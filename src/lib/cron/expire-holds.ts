import { prisma } from '@/lib/db'
import { BookingStatus, type PrismaClient } from '@prisma/client'
import { releaseRedemptionForBooking } from '@/lib/promotions/release'
import { declaredTransferPaymentWhere, declaredPkgTransferPaymentWhere } from '@/lib/bank-transfer/declared'
import {
  sendNotificationSafely,
  sendBankTransferExpiredToCustomer,
  getBusinessReplyToEmail,
} from '@/lib/notifications'

export interface ExpireHoldsResult {
  expired: number
  businessIds: string[]
  declaredTransferExpired: number
  packagesExpired: number
}

interface ExpireHoldsDeps {
  sendExpiredEmail: typeof sendBankTransferExpiredToCustomer
}

/**
 * Expira transaccionalmente reservas pending_payment cuyo hold haya vencido.
 * El updateMany repite las condiciones de findMany para evitar races
 * con pagos que entren entre la búsqueda y la actualización.
 */
export async function expireStaleHolds(
  now = new Date(),
  db: Pick<PrismaClient, 'booking' | 'payment' | '$transaction' | 'packagePurchase'> = prisma,
  deps: ExpireHoldsDeps = { sendExpiredEmail: sendBankTransferExpiredToCustomer }
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

  const expiredBookings = await db.booking.findMany({
    where: {
      status: BookingStatus.pending_payment,
      holdExpiresAt: { lt: now },
      paymentStatus: 'unpaid',
    },
    select: { id: true, businessId: true },
  })

  if (expiredBookings.length === 0) {
    return { expired: 0, businessIds: [...packageBusinessIds], declaredTransferExpired: 0, packagesExpired }
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
    // Filter through the booking relation so we only release redemptions whose
    // booking ACTUALLY transitioned to `expired` in this same tx snapshot.
    // A booking that won the payment race (got confirmed/paid in the race window)
    // is re-excluded by the in-tx updateMany guard above; releasing it would
    // corrupt a live redemption and free a capped slot still in use.
    const reds = await tx.promotionRedemption.findMany({
      where: {
        status: 'applied',
        booking: { id: { in: expiredIds }, status: BookingStatus.expired },
      },
      select: { bookingId: true },
    })
    for (const r of reds) {
      await releaseRedemptionForBooking(tx, r.bookingId, 'hold_expired')
    }

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

  // Emails best-effort para las transferencias declaradas expiradas (post-tx).
  // Un cron procesa lotes: resolvemos el reply-to una vez por negocio y mandamos
  // los emails en paralelo (sendNotificationSafely traga sus propios errores).
  if (declaredBookingIds.length > 0) {
    const toNotify = await prisma.booking.findMany({
      where: { id: { in: declaredBookingIds } },
      include: { customer: true, service: true, business: true },
    })
    const replyToByBiz = new Map<string, string | null>()
    await Promise.all(
      [...new Set(toNotify.map((b) => b.businessId))].map(async (bizId) => {
        replyToByBiz.set(bizId, await getBusinessReplyToEmail(bizId))
      })
    )
    await Promise.all(
      toNotify
        .filter((b) => b.customer?.email)
        .map((b) =>
          sendNotificationSafely('bank transfer expired', () =>
            deps.sendExpiredEmail({
              businessName: b.business.name,
              businessTimezone: b.business.timezone || 'America/Santiago',
              businessReplyToEmail: replyToByBiz.get(b.businessId) ?? null,
              customerName: b.customer!.name,
              customerEmail: b.customer!.email!,
              serviceName: b.service?.name ?? 'servicio',
              startDateTime: b.startDateTime,
              bookingNumber: b.bookingNumber,
            })
          )
        )
    )
  }

  // Solo revalidar los negocios cuyas reservas REALMENTE se actualizaron.
  // Como no podemos saber cuáles IDs se actualizaron sin query adicional,
  // usamos el count. Si el count difiere del length, significa que hubo races.
  // En ese caso revalidamos todos los candidatos (conservador pero correcto).
  const businessIds = [
    ...new Set([...expiredBookings.map((b) => b.businessId), ...packageBusinessIds]),
  ]

  return {
    expired: count,
    businessIds,
    declaredTransferExpired: declaredBookingIds.length,
    packagesExpired,
  }
}
