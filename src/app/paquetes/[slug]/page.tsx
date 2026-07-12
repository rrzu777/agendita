export const dynamic = 'force-dynamic'

import { notFound, redirect } from 'next/navigation'
import { PackagesBusinessPage } from '@/components/packages/packages-business-page'
import { getPackagesBusinessBySlug } from '@/lib/business/public'
import { getTenantFromRequest } from '@/lib/tenant/resolver'
import { resolveOnlinePaymentAvailabilityForBusiness } from '@/lib/payments/factory'
import { getPackageCheckoutPrefill } from '@/server/actions/packages-checkout'

interface PaquetesPageProps {
  params: Promise<{ slug: string }>
}

export default async function PaquetesSlugPage({ params }: PaquetesPageProps) {
  const { slug } = await params
  const tenant = await getTenantFromRequest()

  if (tenant) {
    if (tenant.slug !== slug) {
      notFound()
    }

    redirect('/paquetes')
  }

  const business = await getPackagesBusinessBySlug(slug)

  if (!business) {
    notFound()
  }

  const [availability, prefill] = await Promise.all([
    resolveOnlinePaymentAvailabilityForBusiness(business.id),
    getPackageCheckoutPrefill(business.id),
  ])

  return (
    <PackagesBusinessPage
      business={business}
      profileHref={`/b/${business.slug}`}
      onlineAvailable={availability.available}
      onlineReason={availability.reason ?? null}
      prefill={prefill}
    />
  )
}
