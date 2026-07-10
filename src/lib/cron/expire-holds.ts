import { prisma } from '@/lib/db'
import { BookingStatus, type PrismaClient } from '@prisma/client'
import { releaseRedemptionForBooking } from '@/lib/promotions/release'
import { declaredTransferPaymentWhere } from '@/lib/bank-transfer/declared'
import {
  sendNotificationSafely,
  sendBankTransferExpiredToCustomer,
  getBusinessReplyToEmail,
} from '@/lib/notifications'

export interface ExpireHoldsResult {
  expired: number
  businessIds: string[]
  declaredTransferExpired: number
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
  db: Pick<PrismaClient, 'booking' | 'payment' | '$transaction'> = prisma,
  deps: ExpireHoldsDeps = { sendExpiredEmail: sendBankTransferExpiredToCustomer }
): Promise<ExpireHoldsResult> {
  const expiredBookings = await db.booking.findMany({
    where: {
      status: BookingStatus.pending_payment,
      holdExpiresAt: { lt: now },
      paymentStatus: 'unpaid',
    },
    select: { id: true, businessId: true },
  })

  if (expiredBookings.length === 0) {
    return { expired: 0, businessIds: [], declaredTransferExpired: 0 }
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

    // Qué candidatos REALMENTE transicionaron a `expired` en esta corrida.
    const expiredNow = await tx.booking.findMany({
      where: { id: { in: expiredIds }, status: BookingStatus.expired },
      select: { id: true },
    })
    const expiredNowIds = expiredNow.map((b) => b.id)

    // Cerrar el Payment declarado huérfano (bt-declared) de esas reservas para
    // que no quede `pending` para siempre. Guardado por declaredTransferPaymentWhere.
    const declaredPayments = await tx.payment.findMany({
      where: { bookingId: { in: expiredNowIds }, ...declaredTransferPaymentWhere },
      select: { bookingId: true },
    })
    const declaredBookingIds = declaredPayments.map((p) => p.bookingId)
    if (declaredBookingIds.length > 0) {
      await tx.payment.updateMany({
        where: { bookingId: { in: declaredBookingIds }, ...declaredTransferPaymentWhere },
        data: { status: 'cancelled' },
      })
    }
    return { count: res.count, declaredBookingIds }
  })

  // Emails best-effort para las transferencias declaradas expiradas (post-tx).
  if (declaredBookingIds.length > 0) {
    const toNotify = await prisma.booking.findMany({
      where: { id: { in: declaredBookingIds } },
      include: { customer: true, service: true, business: true },
    })
    for (const b of toNotify) {
      if (!b.customer?.email) continue
      const replyTo = await getBusinessReplyToEmail(b.businessId)
      await sendNotificationSafely('bank transfer expired', () =>
        deps.sendExpiredEmail({
          businessName: b.business.name,
          businessTimezone: b.business.timezone || 'America/Santiago',
          businessReplyToEmail: replyTo,
          customerName: b.customer!.name,
          customerEmail: b.customer!.email!,
          serviceName: b.service?.name ?? 'servicio',
          startDateTime: b.startDateTime,
          bookingNumber: b.bookingNumber,
        })
      )
    }
  }

  // Solo revalidar los negocios cuyas reservas REALMENTE se actualizaron.
  // Como no podemos saber cuáles IDs se actualizaron sin query adicional,
  // usamos el count. Si el count difiere del length, significa que hubo races.
  // En ese caso revalidamos todos los candidatos (conservador pero correcto).
  const businessIds = [...new Set(expiredBookings.map((b) => b.businessId))]

  return {
    expired: count,
    businessIds,
    declaredTransferExpired: declaredBookingIds.length,
  }
}
