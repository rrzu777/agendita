import type { Prisma, PrismaClient } from '@prisma/client'

type Db = PrismaClient | Prisma.TransactionClient

// businessId siempre se filtra (invariante de tenant): aunque una Customer pertenece
// a un solo negocio, scopear la query lo hace seguro por construcción ante cualquier
// call site futuro.
export async function getLoyaltyBalance(db: Db, customerId: string, businessId: string): Promise<number> {
  const agg = await db.loyaltyLedger.aggregate({ where: { customerId, businessId }, _sum: { points: true } })
  return agg._sum.points ?? 0
}

export async function getLoyaltyHistory(db: Db, customerId: string, businessId: string, limit = 50) {
  return db.loyaltyLedger.findMany({
    where: { customerId, businessId },
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: { booking: { select: { id: true, startDateTime: true } } },
  })
}
