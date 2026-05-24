import { unstable_cache } from 'next/cache'
import { prisma } from '@/lib/db'
import type { Prisma } from '@prisma/client'

export const publicBusinessInclude = {
  services: {
    where: { isActive: true },
    orderBy: { sortOrder: 'asc' },
  },
  availability: {
    where: { isActive: true },
    orderBy: { dayOfWeek: 'asc' },
  },
  reviews: {
    where: { isApproved: true, isHidden: false },
    orderBy: { createdAt: 'desc' },
    take: 3,
    include: { customer: true },
  },
  _count: {
    select: {
      reviews: {
        where: { isApproved: true, isHidden: false },
      },
    },
  },
} satisfies Prisma.BusinessInclude

export type PublicBusiness = Prisma.BusinessGetPayload<{
  include: typeof publicBusinessInclude
}>

// NOTE: unstable_cache tags must be stable at definition time.
// Per-business cache invalidation is handled by revalidateBusinessPublicPaths()
// which uses revalidateTag() with dynamic business identifiers fetched from DB.
// These cache entries are keyed by slug so cross-tenant leakage is prevented
// by the cache key itself (slug is part of the function arguments).

export const getPublicBusinessBySlug = unstable_cache(async (slug: string) => {
  const business = await prisma.business.findUnique({
    relationLoadStrategy: 'join',
    where: { slug },
    include: publicBusinessInclude,
  })

  return business?.isActive ? business : null
}, ['public-business-by-slug'], { revalidate: 300, tags: ['public-business-by-slug'] })

export const getPublicBusinessBySubdomain = unstable_cache(async (subdomain: string) => {
  const business = await prisma.business.findUnique({
    relationLoadStrategy: 'join',
    where: { subdomain },
    include: publicBusinessInclude,
  })

  return business?.isActive ? business : null
}, ['public-business-by-subdomain'], { revalidate: 300, tags: ['public-business-by-subdomain'] })

export const getBookingBusinessBySlug = unstable_cache(async (slug: string) => {
  const business = await prisma.business.findUnique({
    relationLoadStrategy: 'join',
    where: { slug },
    include: {
      services: {
        where: { isActive: true },
        orderBy: { sortOrder: 'asc' },
      },
    },
  })

  return business?.isActive ? business : null
}, ['booking-business-by-slug'], { revalidate: 60, tags: ['booking-business-by-slug'] })

export const getBookingBusinessBySubdomain = unstable_cache(async (subdomain: string) => {
  const business = await prisma.business.findUnique({
    relationLoadStrategy: 'join',
    where: { subdomain },
    include: {
      services: {
        where: { isActive: true },
        orderBy: { sortOrder: 'asc' },
      },
    },
  })

  return business?.isActive ? business : null
}, ['booking-business-by-subdomain'], { revalidate: 60, tags: ['booking-business-by-subdomain'] })

export type BookingBusiness = NonNullable<Awaited<ReturnType<typeof getBookingBusinessBySlug>>>