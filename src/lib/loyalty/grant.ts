import type { Prisma, PrismaClient } from '@prisma/client'

type TxLike = Prisma.TransactionClient | PrismaClient

/** Reconcilia los grants vencidos de una clienta (lazy, sin cron). Idempotente:
 *  el guard `updateMany` garantiza que sólo la llamada que hace el flip inserta el
 *  reembolso. Corre en toda superficie que muestre saldo.
 *  IMPORTANTE: debe ejecutarse DENTRO de una transacción para que el flip a
 *  `reversed` y el asiento de reembolso sean atómicos (un crash entre ambos dejaría
 *  el grant consumido sin devolver los puntos). `redeemForGrant` ya la llama dentro
 *  de su tx; los demás callers la envuelven en `prisma.$transaction(tx => ...)`. */
export async function reconcileExpiredGrants(
  db: TxLike,
  customerId: string,
  businessId: string,
  now: Date = new Date(),
): Promise<void> {
  const expired = await db.promotionGrant.findMany({
    where: { customerId, businessId, status: 'active', expiresAt: { lt: now } },
    select: { id: true, businessId: true, customerId: true, pointsSpent: true, refundOnExpiry: true },
  })
  for (const g of expired) {
    await expireGrantWithRefund(db, g, 'active', now)
  }
}

/** Vence un grant: flip atómico desde `fromStatus` y, si `refundOnExpiry`, inserta el
 *  asiento de reembolso. El guard del `updateMany` lo hace idempotente (sólo la llamada
 *  que gana el flip inserta el reembolso). Compartido por la reconciliación lazy
 *  (`fromStatus='active'`) y el release de una reserva con grant (`fromStatus='redeemed'`). */
export async function expireGrantWithRefund(
  db: TxLike,
  grant: { id: string; businessId: string; customerId: string; pointsSpent: number; refundOnExpiry: boolean },
  fromStatus: 'active' | 'redeemed',
  now: Date,
): Promise<void> {
  if (!grant.refundOnExpiry) {
    await db.promotionGrant.updateMany({
      where: { id: grant.id, status: fromStatus },
      data: { status: 'expired' },
    })
    return
  }
  const flipped = await db.promotionGrant.updateMany({
    where: { id: grant.id, status: fromStatus },
    data: { status: 'reversed', reversedAt: now },
  })
  if (flipped.count === 1) {
    await db.loyaltyLedger.create({
      data: {
        businessId: grant.businessId, customerId: grant.customerId, points: grant.pointsSpent,
        reason: 'redemption_reversal', metadata: { grantId: grant.id },
      },
    })
  }
}
