import type { Prisma, PrismaClient, RedemptionRelease } from '@prisma/client'

type TxLike = Prisma.TransactionClient | PrismaClient

/** Libera (si existe y está `applied`) el canje de una reserva y decrementa el
 *  contador con piso. Idempotente: no hace nada si ya está liberado o no existe. */
export async function releaseRedemptionForBooking(
  tx: TxLike,
  bookingId: string,
  reason: RedemptionRelease,
): Promise<void> {
  const r = await tx.promotionRedemption.findUnique({ where: { bookingId } })
  if (!r || r.status !== 'applied') return
  await tx.promotionRedemption.update({
    where: { id: r.id },
    data: { status: 'released', releaseReason: reason, releasedAt: new Date() },
  })
  await tx.promotion.updateMany({
    where: { id: r.promotionId, redemptionCount: { gt: 0 } },
    data: { redemptionCount: { decrement: 1 } },
  })
}

/** Recalcula redemptionCount de una promo desde el libro de canjes (sana drift). */
export async function reconcileRedemptionCount(
  db: PrismaClient,
  promotionId: string,
): Promise<number> {
  const count = await db.promotionRedemption.count({ where: { promotionId, status: 'applied' } })
  await db.promotion.update({ where: { id: promotionId }, data: { redemptionCount: count } })
  return count
}
