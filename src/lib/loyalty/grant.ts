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
    if (g.refundOnExpiry) {
      const flipped = await db.promotionGrant.updateMany({
        where: { id: g.id, status: 'active' },
        data: { status: 'reversed', reversedAt: now },
      })
      if (flipped.count === 1) {
        await db.loyaltyLedger.create({
          data: {
            businessId: g.businessId, customerId: g.customerId, points: g.pointsSpent,
            reason: 'redemption_reversal', metadata: { grantId: g.id },
          },
        })
      }
    } else {
      await db.promotionGrant.updateMany({
        where: { id: g.id, status: 'active' },
        data: { status: 'expired' },
      })
    }
  }
}
