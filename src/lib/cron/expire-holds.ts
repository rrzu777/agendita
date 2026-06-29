import { prisma } from '@/lib/db'
import { BookingStatus, type PrismaClient } from '@prisma/client'
import { releaseRedemptionForBooking } from '@/lib/promotions/release'

export interface ExpireHoldsResult {
  expired: number
  businessIds: string[]
}

/**
 * Expira transaccionalmente reservas pending_payment cuyo hold haya vencido.
 * El updateMany repite las condiciones de findMany para evitar races
 * con pagos que entren entre la búsqueda y la actualización.
 */
export async function expireStaleHolds(
  now = new Date(),
  db: Pick<PrismaClient, 'booking' | '$transaction'> = prisma
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
    return { expired: 0, businessIds: [] }
  }

  const expiredIds = expiredBookings.map((b) => b.id)

  const updateResult = await db.$transaction(async (tx) => {
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
    return res
  })

  // Solo revalidar los negocios cuyas reservas REALMENTE se actualizaron.
  // Como no podemos saber cuáles IDs se actualizaron sin query adicional,
  // usamos el count. Si el count difiere del length, significa que hubo races.
  // En ese caso revalidamos todos los candidatos (conservador pero correcto).
  const businessIds = [...new Set(expiredBookings.map((b) => b.businessId))]

  return {
    expired: updateResult.count,
    businessIds,
  }
}
