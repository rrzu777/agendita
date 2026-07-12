import { notFound, redirect } from 'next/navigation'
import { Metadata } from 'next'
import { BusinessProfile } from '@/components/public/business-profile'
import { getPublicBusinessBySlug } from '@/lib/business/public'
import { getTenantFromRequest } from '@/lib/tenant/resolver'
import { getAccountCta, getFunnelSession } from '@/lib/customers/session-prefill'
import { prisma } from '@/lib/db'

// El CTA de cuenta lee la sesión (cookies) → la page es por-request. La anotación
// ISR anterior (revalidate = 300) ya no aplicaba (getTenantFromRequest lee headers).
export const dynamic = 'force-dynamic'

interface ProfilePageProps {
  params: Promise<{ slug: string }>
}

export async function generateMetadata({ params }: ProfilePageProps): Promise<Metadata> {
  const { slug } = await params
  const business = await getPublicBusinessBySlug(slug)

  if (!business) return { title: 'Perfil no encontrado' }

  return {
    title: `${business.name} — Reserva tu hora`,
    description: business.bio || `Reserva tu hora en ${business.name}`,
  }
}

export default async function PublicProfilePage({ params }: ProfilePageProps) {
  const { slug } = await params
  const tenant = await getTenantFromRequest()

  if (tenant) {
    if (tenant.slug !== slug) {
      notFound()
    }

    redirect('/')
  }

  const business = await getPublicBusinessBySlug(slug)

  if (!business) {
    notFound()
  }

  const session = await getFunnelSession(business.id)
  const hasPackages = (await prisma.packageProduct.count({ where: { businessId: business.id, isActive: true } })) > 0

  return (
    <BusinessProfile
      business={business}
      accountCta={getAccountCta(session, business.slug)}
      packagesHref={hasPackages ? `/paquetes/${business.slug}` : undefined}
    />
  )
}
