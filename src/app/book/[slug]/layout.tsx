import type { ReactNode } from 'react'
import { BusinessTheme } from '@/components/theme/business-theme'
import { getBookingBusinessBySlug } from '@/lib/business/public'

export default async function BookingBusinessLayout({ children, params }: { children: ReactNode; params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const business = await getBookingBusinessBySlug(slug)
  return business ? <BusinessTheme business={business}>{children}</BusinessTheme> : children
}
