import type { ReactNode } from 'react'
import { BusinessTheme } from '@/components/theme/business-theme'
import { getPublicBusinessBySlug } from '@/lib/business/public'
import type { Viewport } from 'next'

export async function generateViewport({ params }: { params: Promise<{ slug: string }> }): Promise<Viewport> {
  const business = await getPublicBusinessBySlug((await params).slug).catch(() => null)
  return { themeColor: business?.brandColor || '#f7f7f4' }
}

export default async function PublicBusinessLayout({ children, params }: { children: ReactNode; params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const business = await getPublicBusinessBySlug(slug).catch(() => null)
  return business ? <BusinessTheme business={business}>{children}</BusinessTheme> : children
}
