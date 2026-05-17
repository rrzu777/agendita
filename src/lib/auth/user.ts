import { createClient } from './middleware'
import { prisma } from '@/lib/db'

export async function getCurrentUser() {
  const supabase = await createClient()
  const { data: { user }, error } = await supabase.auth.getUser()

  if (error || !user) {
    return null
  }

  return user
}

export async function getCurrentSession() {
  const supabase = await createClient()
  const { data: { session }, error } = await supabase.auth.getSession()

  if (error || !session) {
    return null
  }

  return session
}

export async function getCurrentUserWithBusiness() {
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
}
