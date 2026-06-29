import type { Prisma, PrismaClient } from '@prisma/client'

type Db = PrismaClient | Prisma.TransactionClient

/** Devuelve el loyaltyToken de la clienta, generándolo (lazy) si falta. */
export async function ensureLoyaltyToken(
  db: Db,
  customer: { id: string; loyaltyToken: string | null },
): Promise<string> {
  if (customer.loyaltyToken) return customer.loyaltyToken
  const token = crypto.randomUUID()
  await db.customer.update({ where: { id: customer.id }, data: { loyaltyToken: token } })
  return token
}

/** Construye el link a "Mi tarjeta" si el programa está activo. Encapsula el guard
 *  + la generación lazy del token. El `baseUrl` (sin barra final) lo decide cada
 *  caller: la confirmación usa el dominio configurado (puede correr desde webhook),
 *  el pedido de reseña usa el host del request (subdominio del tenant). */
export async function buildLoyaltyCardLink(
  db: Db,
  customer: { id: string; loyaltyToken: string | null },
  config: { isActive: boolean } | null | undefined,
  baseUrl: string,
): Promise<string | undefined> {
  if (!config?.isActive) return undefined
  const token = await ensureLoyaltyToken(db, customer)
  return `${baseUrl}/tarjeta/${token}`
}

/** Resuelve la clienta + negocio + config a partir del token de "Mi tarjeta". */
export async function resolveLoyaltyCustomer(db: Db, token: string) {
  if (!token) return null
  const customer = await db.customer.findUnique({
    where: { loyaltyToken: token },
    select: {
      id: true, name: true, businessId: true,
      business: { select: { name: true, logoUrl: true, loyaltyConfig: true } },
    },
  })
  if (!customer || !customer.business) return null
  return customer
}
