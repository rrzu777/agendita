import type { Prisma, PrismaClient, RedemptionRelease } from '@prisma/client'
import { expireGrantWithRefund } from '@/lib/loyalty/grant'

type TxLike = Prisma.TransactionClient | PrismaClient

/** Libera (si existe y está `applied`) el canje de una reserva. Idempotente:
 *  no hace nada si ya está liberado o no existe.
 *  - Promo por código: decrementa redemptionCount con piso.
 *  - Promo por grant: reactiva la recompensa (no decrementa stock). */
export async function releaseRedemptionForBooking(
  tx: TxLike,
  bookingId: string,
  reason: RedemptionRelease,
): Promise<void> {
  // Need promotionId for the decrement.
  const r = await tx.promotionRedemption.findUnique({ where: { bookingId } })
  if (!r || r.status !== 'applied') return
  // Atomic guard: only the call that flips applied->released proceeds.
  const flipped = await tx.promotionRedemption.updateMany({
    where: { bookingId, status: 'applied' },
    data: { status: 'released', releaseReason: reason, releasedAt: new Date() },
  })
  if (flipped.count === 0) return // lost the race; another release already flipped it

  const promo = await tx.promotion.findUnique({
    where: { id: r.promotionId }, select: { triggerType: true },
  })
  if (promo?.triggerType === 'granted') {
    // El stock del grant se consumió al canjear (no al aplicar) => NO decrementar.
    await reactivateGrantForBooking(tx, bookingId, reason)
    return
  }

  await tx.promotion.updateMany({
    where: { id: r.promotionId, redemptionCount: { gt: 0 } },
    data: { redemptionCount: { decrement: 1 } },
  })
}

/** Al liberarse una reserva con grant aplicado: reactivar la recompensa para que la
 *  clienta la recupere. En no_show se reactiva salvo que el grant tenga el snapshot
 *  forfeitOnNoShow. Si el grant ya venció, se aplica la política de vencimiento. */
async function reactivateGrantForBooking(
  tx: TxLike,
  bookingId: string,
  reason: RedemptionRelease,
): Promise<void> {
  const grant = await tx.promotionGrant.findFirst({ where: { redeemedBookingId: bookingId } })
  if (!grant) return
  if (reason === 'no_show' && grant.forfeitOnNoShow) return // se pierde

  const now = new Date()
  const expired = grant.expiresAt != null && now > grant.expiresAt
  if (expired) {
    await expireGrantWithRefund(tx, grant, 'redeemed', now)
    return
  }

  await tx.promotionGrant.updateMany({
    where: { id: grant.id, status: 'redeemed', redeemedBookingId: bookingId },
    data: { status: 'active', redeemedBookingId: null, redeemedAt: null },
  })
}

/** Mantenimiento: recalcula redemptionCount de una promo desde el libro de canjes
 *  para sanar drift. Escribe un valor ABSOLUTO, así que puede pisar el incremento
 *  de un apply concurrente — correr sólo cuando no hay aplicaciones en curso
 *  (mantenimiento), nunca en un hot path. */
export async function reconcileRedemptionCount(
  db: PrismaClient,
  promotionId: string,
): Promise<number> {
  const count = await db.promotionRedemption.count({ where: { promotionId, status: 'applied' } })
  await db.promotion.update({ where: { id: promotionId }, data: { redemptionCount: count } })
  return count
}
