import type { Prisma, PrismaClient, RedemptionRelease } from '@prisma/client'

type TxLike = Prisma.TransactionClient | PrismaClient

/** Libera (si existe y está `applied`) el canje de una reserva y decrementa el
 *  contador con piso. Idempotente: no hace nada si ya está liberado o no existe. */
export async function releaseRedemptionForBooking(
  tx: TxLike,
  bookingId: string,
  reason: RedemptionRelease,
): Promise<void> {
  // Need promotionId for the decrement.
  const r = await tx.promotionRedemption.findUnique({ where: { bookingId } })
  if (!r || r.status !== 'applied') return
  // Atomic guard: only the call that flips applied->released proceeds to decrement.
  const flipped = await tx.promotionRedemption.updateMany({
    where: { bookingId, status: 'applied' },
    data: { status: 'released', releaseReason: reason, releasedAt: new Date() },
  })
  if (flipped.count === 0) return // lost the race; another release already flipped it
  await tx.promotion.updateMany({
    where: { id: r.promotionId, redemptionCount: { gt: 0 } },
    data: { redemptionCount: { decrement: 1 } },
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
