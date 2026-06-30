export const dynamic = 'force-dynamic'

import { notFound, redirect } from 'next/navigation'
import { BookingBusinessPage } from '@/components/booking/booking-business-page'
import { getBookingBusinessBySlug } from '@/lib/business/public'
import { getTenantFromRequest } from '@/lib/tenant/resolver'

// Los referralToken son UUID v4 (crypto.randomUUID). Validar la forma reduce la
// superficie y evita lookups innecesarios con tokens arbitrarios.
const REFERRAL_TOKEN_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface BookPageProps {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}

export default async function BookPage({ params, searchParams }: BookPageProps) {
  const { slug } = await params
  const { ref } = await searchParams
  const referralToken = typeof ref === 'string' && REFERRAL_TOKEN_RE.test(ref) ? ref : undefined
  const tenant = await getTenantFromRequest()

  if (tenant) {
    if (tenant.slug !== slug) {
      notFound()
    }

    redirect('/book')
  }

  const business = await getBookingBusinessBySlug(slug)

  if (!business) {
    notFound()
  }

  return <BookingBusinessPage business={business} profileHref={`/b/${business.slug}`} referralToken={referralToken} />
}
