import { cache } from 'react'
import { getConfirmedSessionUser } from './user'
import { ensureUserRow, AccountConflictError } from './ensure-user-row'
import { isVerifiedEmail, linkCustomersByVerifiedEmail } from '@/lib/customers/link'
import { prisma } from '@/lib/db'

type SessionUser = NonNullable<Awaited<ReturnType<typeof getConfirmedSessionUser>>>

export type MiUserResult =
  | { status: 'ok'; user: SessionUser }
  | { status: 'anon' }
  | { status: 'conflict'; message: string }

/**
 * Prepara al usuario de /mi UNA sola vez por request (React `cache`): asegura la
 * fila User de Prisma y vincula sus Customers por email verificado.
 *
 * Clave del fix: en el App Router el layout y la page se renderizan EN PARALELO,
 * así que la vinculación hecha en el layout no está garantizada antes de que la
 * page lea sus Customers — en la primera carga /mi aparecía vacío. Al centralizar
 * la preparación en esta función cacheada y hacer que la page la `await`-ee ANTES
 * de leer, la vinculación (updateMany) ya commiteó cuando la page consulta.
 *
 * `ensureUserRow` corre antes del link (el FK Customer.userId → User.id lo exige)
 * y sólo lanza AccountConflictError en el caso raro de email ya asociado a otra
 * cuenta; lo devolvemos como estado para que layout y pages lo manejen sin crashear.
 */
export const prepareMiUser = cache(async (): Promise<MiUserResult> => {
  // Remoto (getUser): la vinculación por email verificado (abajo) exige el
  // email_confirmed_at confiable, que getCurrentUser (local) no expone. /mi es
  // de baja frecuencia y ya hace escrituras, así que el round-trip es aceptable.
  const user = await getConfirmedSessionUser()
  if (!user) return { status: 'anon' }

  try {
    await ensureUserRow(user)
  } catch (e) {
    if (e instanceof AccountConflictError) return { status: 'conflict', message: e.message }
    throw e
  }

  if (user.email && isVerifiedEmail(user)) {
    await linkCustomersByVerifiedEmail(prisma, user.id, user.email)
  }

  return { status: 'ok', user }
})
