import type { ReactNode } from 'react'
import { BusinessTheme } from '@/components/theme/business-theme'
import { getBookingBusinessBySlug } from '@/lib/business/public'
import type { Viewport } from 'next'
import { businessThemeColor } from '@/lib/theme/business-theme'

export async function generateViewport({ params }: { params: Promise<{ slug: string }> }): Promise<Viewport> {
  const business = await getBookingBusinessBySlug((await params).slug).catch(() => null)
  return { themeColor: business ? businessThemeColor(business) : '#f7f7f4' }
}

export default async function BookingBusinessLayout({ children, params }: { children: ReactNode; params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const business = await getBookingBusinessBySlug(slug).catch(() => null)
  return business ? <BusinessTheme business={business}>{children}</BusinessTheme> : children
}
