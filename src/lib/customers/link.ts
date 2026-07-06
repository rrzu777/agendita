import type { Prisma, PrismaClient } from '@prisma/client'

type Db = PrismaClient | Prisma.TransactionClient

/** Solo emails verificados habilitan la vinculación automática. SOLO se confía
 *  en `email_confirmed_at` (Supabase lo setea para Google y para OTP en D2):
 *  `user_metadata` es escribible por el propio usuario vía updateUser, así que
 *  `user_metadata.email_verified` NO es una señal confiable. */
export function isVerifiedEmail(user: {
  email?: string | null
  email_confirmed_at?: string | null
}): boolean {
  if (!user.email) return false
  return Boolean(user.email_confirmed_at)
}

/** Guard compartido: los miembros del negocio (owner/staff) no se vinculan como
 *  clientas de su propio negocio — suelen cargar clientas con su email o tienen
 *  acceso a todos los tokens de tarjeta. */
async function memberBusinessIds(db: Db, userId: string): Promise<string[]> {
  const memberships = await db.businessUser.findMany({
    where: { userId },
    select: { businessId: true },
  })
  return memberships.map((m) => m.businessId)
}

/** Vía 1: auto-link por email verificado. Idempotente y barato (corre en cada
 *  entrada a /mi). Nunca pisa un userId existente. Excluye negocios donde el
 *  user es miembro (ver memberBusinessIds). */
export async function linkCustomersByVerifiedEmail(db: Db, userId: string, email: string): Promise<number> {
  const normalized = email.trim()
  if (!normalized) return 0
  const excluded = await memberBusinessIds(db, userId)
  const res = await db.customer.updateMany({
    where: {
      email: { equals: normalized, mode: 'insensitive' },
      userId: null,
      ...(excluded.length > 0 ? { businessId: { notIn: excluded } } : {}),
    },
    data: { userId },
  })
  return res.count
}

/** Vía 3: reserva hecha con sesión activa. Guards: nunca pisar un userId
 *  existente; el email de la fila debe coincidir con el email VERIFICADO de la
 *  sesión (reservar con el teléfono de otra persona no debe vincular su
 *  Customer); NO vincular a miembros del negocio (owner/staff reservando para
 *  clientas — y el bypass e2e usa la sesión de la dueña); solo si la fila User
 *  de Prisma existe (clientas que ya pasaron por /mi; si no, quedará vinculada
 *  en su próxima visita a /mi). Pensada para correr dentro de la tx de
 *  createBooking. */
export async function linkCustomerFromBookingSession(
  db: Db,
  customer: { id: string; userId: string | null; email: string | null },
  sessionUser: { id: string; email?: string | null; email_confirmed_at?: string | null },
  businessId: string,
): Promise<boolean> {
  if (customer.userId) return false
  if (!isVerifiedEmail(sessionUser) || !customer.email) return false
  if (customer.email.trim().toLowerCase() !== sessionUser.email!.trim().toLowerCase()) return false
  const [isMember, userRow] = await Promise.all([
    db.businessUser.findFirst({ where: { userId: sessionUser.id, businessId }, select: { id: true } }),
    db.user.findUnique({ where: { id: sessionUser.id }, select: { id: true } }),
  ])
  if (isMember || !userRow) return false
  const res = await db.customer.updateMany({
    where: { id: customer.id, userId: null },
    data: { userId: sessionUser.id },
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
 *  atómico sobre userId null para que dos cuentas no puedan pisarse en carrera.
 *  Los miembros del negocio no pueden reclamar tarjetas de sus clientas (tienen
 *  acceso a todos los tokens desde el dashboard). */
export async function linkCustomerByLoyaltyToken(db: Db, userId: string, token: string): Promise<void> {
  const customer = await db.customer.findUnique({
    where: { loyaltyToken: token },
    select: { id: true, userId: true, businessId: true },
  })
  if (!customer) throw new CardLinkError('El enlace de la tarjeta no es válido.')
  if (customer.userId === userId) return
  if (customer.userId) throw new CardLinkError('Esta tarjeta ya está vinculada a otra cuenta.')
  const isMember = await db.businessUser.findFirst({
    where: { userId, businessId: customer.businessId },
    select: { id: true },
  })
  if (isMember) throw new CardLinkError('No puedes vincular tarjetas de clientas de tu propio negocio.')
  const res = await db.customer.updateMany({
    where: { id: customer.id, userId: null },
    data: { userId },
  })
  if (res.count === 0) throw new CardLinkError('Esta tarjeta ya está vinculada a otra cuenta.')
}
