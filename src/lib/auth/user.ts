import { cache } from 'react'
import { createClient } from './middleware'
import { prisma } from '@/lib/db'
import { validateE2EHeaders } from './e2e-bypass'

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
    role: 'authenticated',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- must match Supabase User shape dynamically
  } as any
}

export const getCurrentUser = cache(async () => {
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
