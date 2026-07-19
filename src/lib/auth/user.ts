import { cache } from 'react'
import type { User } from '@supabase/supabase-js'
import { createClient } from './middleware'
import { prisma } from '@/lib/db'
import { validateE2EHeaders } from './e2e-bypass'

// Claims que leemos del access token de Supabase (JWT). `sub` es el user id.
type SupabaseJwtClaims = {
  sub: string
  email?: string
  user_metadata?: Record<string, unknown>
}

// Reconstruye el User de Supabase desde los claims del JWT verificado localmente.
// A propósito NO emite `email_confirmed_at`: el JWT no lo trae y su único
// pariente local, `user_metadata.email_verified`, es escribible por el usuario
// (updateUser) — laundearlo al campo confiable rompería el gate de vinculación
// de link.ts. Los flujos que necesitan la confirmación real usan
// getConfirmedSessionUser (getUser remoto). Los consumidores de getCurrentUser
// sólo leen id/email/user_metadata.
function claimsToUser(claims: SupabaseJwtClaims): User {
  return {
    id: claims.sub,
    email: claims.email,
    user_metadata: claims.user_metadata ?? {},
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- claims → User shape
  } as any
}

// Wrapped in React cache() so a single request (layout + page + server actions
// via requireBusiness) shares ONE Supabase auth.getUser() network call + DB
// lookup instead of repeating it 2–3× per navigation.
const getE2ETestUser = cache(async () => {
  const email = await validateE2EHeaders()
  if (!email) return null

  const dbUser = await prisma.user.findUnique({
    where: { email },
    include: { businesses: { include: { business: true }, orderBy: { createdAt: 'desc' } } },
  })

  return dbUser
})

function makeSyntheticUser(dbUser: NonNullable<Awaited<ReturnType<typeof getE2ETestUser>>>) {
  // Synthetic Supabase User — only for E2E test bypass
  return {
    id: dbUser.id,
    email: dbUser.email ?? undefined,
    user_metadata: { name: dbUser.name },
    app_metadata: {},
    aud: 'authenticated',
    created_at: dbUser.createdAt.toISOString(),
    email_confirmed_at: dbUser.createdAt.toISOString(),
    role: 'authenticated',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- must match Supabase User shape dynamically
  } as any
}

export const getCurrentUser = cache(async () => {
  const e2eUser = await getE2ETestUser()
  if (e2eUser) {
    return makeSyntheticUser(e2eUser)
  }

  // getClaims valida la FIRMA del JWT localmente (llaves asimétricas ECC vía
  // jose, JWKS cacheado) en vez de un round-trip a Supabase por navegación.
  // getSession (que getClaims usa internamente) sigue refrescando el token vía
  // refresh token, así que el usuario no se re-loguea. Trade-off: una sesión
  // revocada sigue válida hasta que expira el access token (~1h) o el próximo
  // refresh. Los flujos sensibles infrecuentes (callback MP, recover-business)
  // se quedan con getUser remoto a propósito.
  const supabase = await createClient()
  const { data, error } = await supabase.auth.getClaims()

  if (error || !data?.claims) {
    return null
  }

  return claimsToUser(data.claims as SupabaseJwtClaims)
})

// Igual que getCurrentUser pero con validación REMOTA (getUser): trae el
// `email_confirmed_at` confiable que Supabase setea server-side. getClaims/local
// NO sirve para esto (user_metadata.email_verified es escribible por el usuario,
// ver link.ts). Úsese SOLO donde importa la confirmación real de email —los
// gates de vinculación de /mi y de reserva— que son de baja frecuencia, así que
// el round-trip remoto es aceptable.
export const getConfirmedSessionUser = cache(async () => {
  const e2eUser = await getE2ETestUser()
  if (e2eUser) {
    return makeSyntheticUser(e2eUser)
  }

  const supabase = await createClient()
  const { data: { user }, error } = await supabase.auth.getUser()

  if (error || !user) {
    return null
  }

  return user
})

export const getCurrentSession = cache(async () => {
  const e2eUser = await getE2ETestUser()
  if (e2eUser) {
    return {
      access_token: 'e2e-test-token',
      refresh_token: 'e2e-test-refresh',
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      expires_in: 3600,
      token_type: 'bearer',
      user: makeSyntheticUser(e2eUser),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- synthetic Supabase Session for E2E
    } as any
  }

  const supabase = await createClient()
  const { data: { session }, error } = await supabase.auth.getSession()

  if (error || !session) {
    return null
  }

  return session
})

export const getCurrentUserWithBusiness = cache(async () => {
  const e2eUser = await getE2ETestUser()
  if (e2eUser) {
    const bizEntry = e2eUser.businesses[0]
    return {
      user: makeSyntheticUser(e2eUser),
      business: bizEntry?.business || null,
      role: bizEntry?.role || null,
    }
  }

  const user = await getCurrentUser()
  if (!user) return null

  const businessUser = await prisma.businessUser.findFirst({
    where: { userId: user.id },
    include: { business: true },
    orderBy: { createdAt: 'desc' },
  })

  return {
    user,
    business: businessUser?.business || null,
    role: businessUser?.role || null,
  }
})
