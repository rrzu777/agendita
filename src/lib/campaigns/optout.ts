import type { Prisma, PrismaClient } from '@prisma/client'

type Db = PrismaClient | Prisma.TransactionClient

/** Core del opt-out de marketing: null = acepta campañas. Los callers (dueña por
 *  rol, clienta por token o sesión) resuelven autorización ANTES de llamar acá. */
export function setMarketingOptOut(db: Db, customerId: string, optedOut: boolean) {
  return db.customer.update({
    where: { id: customerId },
    data: { marketingOptOutAt: optedOut ? new Date() : null },
  })
}
