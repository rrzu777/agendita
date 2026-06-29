import type { Prisma, PrismaClient } from '@prisma/client'

type Db = PrismaClient | Prisma.TransactionClient

export async function getLoyaltyBalance(db: Db, customerId: string): Promise<number> {
  const agg = await db.loyaltyLedger.aggregate({ where: { customerId }, _sum: { points: true } })
  return agg._sum.points ?? 0
}

export async function getLoyaltyHistory(db: Db, customerId: string, limit = 50) {
  return db.loyaltyLedger.findMany({
    where: { customerId },
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: { booking: { select: { id: true, startDateTime: true } } },
  })
}
