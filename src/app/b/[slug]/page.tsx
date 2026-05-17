import { notFound, redirect } from 'next/navigation'
import { Metadata } from 'next'
import { BusinessProfile } from '@/components/public/business-profile'
import { getPublicBusinessBySlug } from '@/lib/business/public'
import { getTenantFromRequest } from '@/lib/tenant/resolver'

export const revalidate = 300

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

  return <BusinessProfile business={business} />
}
