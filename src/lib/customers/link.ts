import type { Prisma, PrismaClient } from '@prisma/client'

type Db = PrismaClient | Prisma.TransactionClient

/** Solo emails verificados habilitan el auto-link (Google los garantiza; el guard
 *  queda listo para email OTP en D2). */
export function isVerifiedEmail(user: {
  email?: string | null
  email_confirmed_at?: string | null
  user_metadata?: Record<string, unknown> | null
}): boolean {
  if (!user.email) return false
  return user.user_metadata?.email_verified === true || Boolean(user.email_confirmed_at)
}

/** Vía 1: auto-link por email verificado. Idempotente y barato (corre en cada
 *  entrada a /mi). Nunca pisa un userId existente. */
export async function linkCustomersByVerifiedEmail(db: Db, userId: string, email: string): Promise<number> {
  const normalized = email.trim()
  if (!normalized) return 0
  const res = await db.customer.updateMany({
    where: { email: { equals: normalized, mode: 'insensitive' }, userId: null },
    data: { userId },
  })
  return res.count
}

/** Vía 3: reserva hecha con sesión activa. Guards: nunca pisar un userId
 *  existente; NO vincular a miembros del negocio (owner/staff reservando para
 *  clientas — y el bypass e2e usa la sesión de la dueña); solo si la fila User
 *  de Prisma existe (clientas que ya pasaron por /mi; si no, quedará vinculada
 *  en su próxima visita a /mi). Pensada para correr dentro de la tx de
 *  createBooking. */
export async function linkCustomerFromBookingSession(
  db: Db,
  customer: { id: string; userId: string | null },
  sessionUserId: string,
  businessId: string,
): Promise<boolean> {
  if (customer.userId) return false
  const [isMember, userRow] = await Promise.all([
    db.businessUser.findFirst({ where: { userId: sessionUserId, businessId }, select: { id: true } }),
    db.user.findUnique({ where: { id: sessionUserId }, select: { id: true } }),
  ])
  if (isMember || !userRow) return false
  const res = await db.customer.updateMany({
    where: { id: customer.id, userId: null },
    data: { userId: sessionUserId },
  })
  return res.count > 0
}

export class CardLinkError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CardLinkError'
  }
}

/** Vía 2: link explícito por posesión del token de "Mi tarjeta". El update es
 *  atómico sobre userId null para que dos cuentas no puedan pisarse en carrera. */
export async function linkCustomerByLoyaltyToken(db: Db, userId: string, token: string): Promise<void> {
  const customer = await db.customer.findUnique({
    where: { loyaltyToken: token },
    select: { id: true, userId: true },
  })
  if (!customer) throw new CardLinkError('El enlace de la tarjeta no es válido.')
  if (customer.userId === userId) return
  if (customer.userId) throw new CardLinkError('Esta tarjeta ya está vinculada a otra cuenta.')
  const res = await db.customer.updateMany({
    where: { id: customer.id, userId: null },
    data: { userId },
  })
  if (res.count === 0) throw new CardLinkError('Esta tarjeta ya está vinculada a otra cuenta.')
}
