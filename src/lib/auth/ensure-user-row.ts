import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'

/** La cuenta no puede usarse: email ausente o ya asociado a otra fila User
 *  (p.ej. cuenta de Supabase recreada con el mismo email). NO adoptamos la fila
 *  existente — podría tener membresías BusinessUser de otra persona. */
export class AccountConflictError extends Error {
  constructor(message = 'Tu email ya está asociado a otra cuenta. Escríbenos a soporte para recuperarla.') {
    super(message)
    this.name = 'AccountConflictError'
  }
}

interface SessionUserLike {
  id: string
  email?: string | null
  user_metadata?: { name?: string | null; full_name?: string | null } | null
}

/** Garantiza la fila User de Prisma para el auth user de Supabase (id compartido).
 *  Las dueñas ya la tienen (creada al registrar el negocio); las clientas no. */
export async function ensureUserRow(user: SessionUserLike): Promise<void> {
  if (!user.email) {
    throw new AccountConflictError('Tu cuenta no tiene un email utilizable. Escríbenos a soporte.')
  }
  try {
    await prisma.user.upsert({
      where: { id: user.id },
      update: {},
      create: {
        id: user.id,
        email: user.email,
        name: user.user_metadata?.name ?? user.user_metadata?.full_name ?? null,
      },
    })
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      throw new AccountConflictError()
    }
    throw e
  }
}
