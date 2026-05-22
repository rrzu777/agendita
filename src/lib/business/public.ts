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

export const getPublicBusinessBySlug = unstable_cache(async (slug: string) => {
  const business = await prisma.business.findUnique({
    relationLoadStrategy: 'join',
    where: { slug },
    include: publicBusinessInclude,
  })

  return business?.isActive ? business : null
}, ['public-business-by-slug'], { revalidate: 300, tags: ['public-business'] })

export const getPublicBusinessBySubdomain = unstable_cache(async (subdomain: string) => {
  const business = await prisma.business.findUnique({
    relationLoadStrategy: 'join',
    where: { subdomain },
    include: publicBusinessInclude,
  })

  return business?.isActive ? business : null
}, ['public-business-by-subdomain'], { revalidate: 300, tags: ['public-business'] })

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
}, ['booking-business-by-slug'], { revalidate: 60, tags: ['booking-business'] })

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
}, ['booking-business-by-subdomain'], { revalidate: 60, tags: ['booking-business'] })

export type BookingBusiness = NonNullable<Awaited<ReturnType<typeof getBookingBusinessBySlug>>>
