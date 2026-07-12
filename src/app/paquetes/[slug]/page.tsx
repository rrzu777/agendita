export const dynamic = 'force-dynamic'

import { notFound, redirect } from 'next/navigation'
import { PackagesBusinessPage } from '@/components/packages/packages-business-page'
import { getPackagesBusinessBySlug } from '@/lib/business/public'
import { getTenantFromRequest } from '@/lib/tenant/resolver'
import { resolveOnlinePaymentAvailabilityForBusiness } from '@/lib/payments/factory'
import { getPackageCheckoutPrefill } from '@/server/actions/packages-checkout'
import { getBankTransferInfo } from '@/server/actions/bank-transfer-public'

interface PaquetesPageProps {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ comprar?: string }>
}

export default async function PaquetesSlugPage({ params, searchParams }: PaquetesPageProps) {
  const { slug } = await params
  const { comprar } = await searchParams
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

  const [availability, prefill, transferInfo] = await Promise.all([
    resolveOnlinePaymentAvailabilityForBusiness(business.id),
    getPackageCheckoutPrefill(business.id),
    getBankTransferInfo(business.id),
  ])

  return (
    <PackagesBusinessPage
      business={business}
      profileHref={`/b/${business.slug}`}
      onlineAvailable={availability.available}
      onlineReason={availability.reason ?? null}
      prefill={prefill}
      preselectedProductId={comprar}
      transferInfo={transferInfo}
    />
  )
}
