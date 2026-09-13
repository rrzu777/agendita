import type { ReactNode } from 'react'
import { BusinessTheme } from '@/components/theme/business-theme'
import { getBookingBusinessBySubdomain } from '@/lib/business/public'
import { getTenantFromRequest } from '@/lib/tenant/resolver'
import type { Viewport } from 'next'

async function tenantBusiness() {
  const tenant = await getTenantFromRequest().catch(() => null)
  return tenant ? getBookingBusinessBySubdomain(tenant.subdomain).catch(() => null) : null
}

export async function generateViewport(): Promise<Viewport> {
  const business = await tenantBusiness()
  return { themeColor: business?.brandColor || '#f7f7f4' }
}

export default async function BookingLayout({ children }: { children: ReactNode }) {
  const business = await tenantBusiness()

  return business ? <BusinessTheme business={business}>{children}</BusinessTheme> : children
}
