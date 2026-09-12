export const dynamic = 'force-dynamic'

import { notFound, redirect } from 'next/navigation'
import { BookingBusinessPage } from '@/components/booking/booking-business-page'
import { getBookingBusinessBySlug } from '@/lib/business/public'
import { getTenantFromRequest } from '@/lib/tenant/resolver'
import { getFunnelSession } from '@/lib/customers/session-prefill'
import { appendPublicAcquisitionSearch, getBookingFunnelUrl, publicAcquisitionSearch } from '@/lib/business/urls'
import { PublicAnalytics } from '@/components/analytics/public-analytics'
import { isPublicAnalyticsEligible } from '@/lib/analytics/public-context'
import { getConfiguredAnalyticsConsentVersion } from '@/lib/analytics/budget'

// Los referralToken son UUID v4 (crypto.randomUUID). Validar la forma reduce la
// superficie y evita lookups innecesarios con tokens arbitrarios.
const REFERRAL_TOKEN_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface BookPageProps {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}

export default async function BookPage({ params, searchParams }: BookPageProps) {
  const { slug } = await params
  const search = await searchParams
  const { ref } = search
  const referralToken = typeof ref === 'string' && REFERRAL_TOKEN_RE.test(ref) ? ref : undefined
  const tenant = await getTenantFromRequest()

  if (tenant) {
    if (tenant.slug !== slug) {
      notFound()
    }

    redirect(appendPublicAcquisitionSearch('/book', search))
  }

  const business = await getBookingBusinessBySlug(slug)

  if (!business) {
    notFound()
  }

  // The OAuth return uses the canonical tenant host. Start the draft there too:
  // sessionStorage cannot carry a draft from www to a different subdomain.
  if (business.subdomain) {
    redirect(getBookingFunnelUrl(business, publicAcquisitionSearch(search)))
  }

  const session = await getFunnelSession(business.id)

  return (
    <PublicAnalytics businessId={business.id} slug={business.slug} timezone={business.timezone || 'America/Santiago'} consentVersion={getConfiguredAnalyticsConsentVersion() ?? 1} eligible={await isPublicAnalyticsEligible(business.id)} surface="booking">
    <BookingBusinessPage
      business={business}
      profileHref={`/b/${business.slug}`}
      referralToken={referralToken}
      session={session}
    />
    </PublicAnalytics>
  )
}
