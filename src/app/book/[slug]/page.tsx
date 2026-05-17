export const dynamic = 'force-dynamic'

import { notFound, redirect } from 'next/navigation'
import { BookingBusinessPage } from '@/components/booking/booking-business-page'
import { getBookingBusinessBySlug } from '@/lib/business/public'
import { getTenantFromRequest } from '@/lib/tenant/resolver'

interface BookPageProps {
  params: Promise<{ slug: string }>
}

export default async function BookPage({ params }: BookPageProps) {
  const { slug } = await params
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

  return <BookingBusinessPage business={business} profileHref={`/b/${business.slug}`} />
}
