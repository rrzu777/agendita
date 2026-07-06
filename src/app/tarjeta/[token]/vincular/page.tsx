import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth/user'
import { ensureUserRow, AccountConflictError } from '@/lib/auth/ensure-user-row'
import { linkCustomerByLoyaltyToken, CardLinkError } from '@/lib/customers/link'
import { checkRateLimit } from '@/lib/rate-limit'
import { PageMessage } from '@/components/ui/page-message'

export const metadata: Metadata = { robots: { index: false, follow: false } }

export default async function VincularPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const user = await getCurrentUser()
  if (!user) redirect(`/ingresar?next=/tarjeta/${token}/vincular`)

  const limit = await checkRateLimit('card-link', 10, 60000, { userId: user.id })
  if (!limit.success) {
    return <PageMessage title="No pudimos vincular tu tarjeta" message="Demasiados intentos. Espera un momento y vuelve a intentar." />
  }

  try {
    await ensureUserRow(user)
    await linkCustomerByLoyaltyToken(prisma, user.id, token)
  } catch (e) {
    if (e instanceof AccountConflictError || e instanceof CardLinkError) {
      return <PageMessage title="No pudimos vincular tu tarjeta" message={e.message} />
    }
    throw e
  }

  redirect('/mi')
}
