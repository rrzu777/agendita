export const dynamic = 'force-dynamic'

import { notFound, redirect } from 'next/navigation'
import { BookingBusinessPage } from '@/components/booking/booking-business-page'
import { getBookingBusinessBySlug } from '@/lib/business/public'
import { getTenantFromRequest } from '@/lib/tenant/resolver'

interface BookPageProps {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}

export default async function BookPage({ params, searchParams }: BookPageProps) {
  const { slug } = await params
  const { ref } = await searchParams
  const referralToken = typeof ref === 'string' && ref.length <= 64 ? ref : undefined
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
