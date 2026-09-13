import type { ReactNode } from 'react'
import { BusinessTheme } from '@/components/theme/business-theme'
import { getBookingBusinessBySubdomain } from '@/lib/business/public'
import { getTenantFromRequest } from '@/lib/tenant/resolver'

export default async function BookingLayout({ children }: { children: ReactNode }) {
  const tenant = await getTenantFromRequest()
  const business = tenant ? await getBookingBusinessBySubdomain(tenant.subdomain) : null

  return business ? <BusinessTheme business={business}>{children}</BusinessTheme> : children
}
