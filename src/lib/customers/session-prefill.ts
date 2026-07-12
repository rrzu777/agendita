import { getCurrentUser } from '@/lib/auth/user'
import { prisma } from '@/lib/db'

export interface FunnelSession {
  email: string
  name: string
  phone: string
  hasCustomer: boolean
}

/** Sesión de clienta para el funnel público: email de la sesión + datos de su
 *  Customer vinculada en ESTE negocio (la más antigua, mismo criterio que /mi/[slug]).
 *  Solo lectura sobre la propia sesión — no expone datos de terceros. */
export async function getFunnelSession(businessId: string): Promise<FunnelSession | null> {
  const user = await getCurrentUser()
  if (!user?.email) return null

  const customer = await prisma.customer.findFirst({
    where: { businessId, userId: user.id },
    orderBy: { createdAt: 'asc' },
    select: { name: true, phone: true },
  })

  return {
    email: user.email,
    name: customer?.name || user.user_metadata?.name || user.user_metadata?.full_name || '',
    phone: customer?.phone ?? '',
    hasCustomer: customer !== null,
  }
}
