import { revalidatePath, revalidateTag } from 'next/cache'
import { prisma } from '@/lib/db'

// Tags must match exactly what unstable_cache uses.
// Using stable static tags — per-business isolation is guaranteed by
// the cache key (slug/subdomain as function argument).
const CACHE_TAGS = {
  publicBySlug: 'public-business-by-slug',
  publicBySubdomain: 'public-business-by-subdomain',
  bookingBySlug: 'booking-business-by-slug',
  bookingBySubdomain: 'booking-business-by-subdomain',
} as const

export async function revalidateBusinessPublicPaths(businessId: string) {
  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: { slug: true, subdomain: true },
  })

  if (!business) return

  // Invalidate the stable cache tags (slug-agnostic)
  revalidateTag(CACHE_TAGS.publicBySlug, 'max')
  revalidateTag(CACHE_TAGS.publicBySubdomain, 'max')
  revalidateTag(CACHE_TAGS.bookingBySlug, 'max')
  revalidateTag(CACHE_TAGS.bookingBySubdomain, 'max')

  // Invalidate public paths for this specific business
  revalidatePath('/')
  revalidatePath('/book')
  revalidatePath(`/b/${business.slug}`)
  revalidatePath(`/book/${business.slug}`)
}