import type { ReactNode } from 'react'
import { BusinessTheme } from '@/components/theme/business-theme'
import { getPublicBusinessBySlug } from '@/lib/business/public'

export default async function PublicBusinessLayout({ children, params }: { children: ReactNode; params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const business = await getPublicBusinessBySlug(slug)
  return business ? <BusinessTheme business={business}>{children}</BusinessTheme> : children
}
