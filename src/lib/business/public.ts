import { unstable_cache } from 'next/cache'
import { prisma } from '@/lib/db'
import type { Prisma } from '@prisma/client'
import { funnelProfessionalSelect } from '@/lib/professionals/eligible'

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

// NOTE: NO usar `relationLoadStrategy: 'join'` acá. Con este include anidado
// (reviews + _count) el query engine de Prisma 5.22 hace PANIC
// ("called Option::unwrap() on a None value", query_document/mod.rs) al construir
// el query — 100% reproducible, causaba 500 en /b/[slug] y /book/[slug] cuando la
// caché ISR se revalidaba. La estrategia default ('query') no tiene el bug.
export const getPublicBusinessBySlug = unstable_cache(async (slug: string) => {
  const business = await prisma.business.findUnique({
    where: { slug },
    include: publicBusinessInclude,
  })

  return business?.isActive ? business : null
}, ['public-business-by-slug'], { revalidate: 300, tags: ['public-business-by-slug'] })

export const getPublicBusinessBySubdomain = unstable_cache(async (subdomain: string) => {
  const business = await prisma.business.findUnique({
    where: { subdomain },
    include: publicBusinessInclude,
  })

  return business?.isActive ? business : null
}, ['public-business-by-subdomain'], { revalidate: 300, tags: ['public-business-by-subdomain'] })

// El equipo viaja en el mismo payload que los servicios porque el funnel necesita
// las dos cosas para decidir su PRIMER paso: cuánta gente hace el servicio que la
// clienta acaba de elegir. Pedirlo aparte sería una action pública nueva —otra
// superficie que autorizar y limitar— para un dato que ya está en esta consulta.
//
// `select` y no la fila entera: esto se serializa al navegador. Sale lo que el paso
// muestra y nada más (ver `FunnelProfessional`).
//
// Las dos variantes —slug y subdominio— comparten el include a propósito: son la
// misma pantalla servida por dos caminos, y cuando estaban escritas dos veces era
// cuestión de tiempo que una creciera sin la otra.
export const bookingBusinessInclude = {
  services: {
    where: { isActive: true },
    orderBy: { sortOrder: 'asc' },
  },
  professionals: {
    where: { isActive: true },
    orderBy: { sortOrder: 'asc' },
    select: funnelProfessionalSelect,
  },
} satisfies Prisma.BusinessInclude

export const getBookingBusinessBySlug = unstable_cache(async (slug: string) => {
  const business = await prisma.business.findUnique({
    where: { slug },
    include: bookingBusinessInclude,
  })

  return business?.isActive ? business : null
}, ['booking-business-by-slug'], { revalidate: 60, tags: ['booking-business-by-slug'] })

export const getBookingBusinessBySubdomain = unstable_cache(async (subdomain: string) => {
  const business = await prisma.business.findUnique({
    where: { subdomain },
    include: bookingBusinessInclude,
  })

  return business?.isActive ? business : null
}, ['booking-business-by-subdomain'], { revalidate: 60, tags: ['booking-business-by-subdomain'] })

export type BookingBusiness = NonNullable<Awaited<ReturnType<typeof getBookingBusinessBySlug>>>

export const packagesBusinessInclude = {
  packageProducts: {
    where: { isActive: true },
    orderBy: { createdAt: 'asc' },
    include: {
      services: { select: { id: true, name: true } },
    },
  },
} satisfies Prisma.BusinessInclude

export type PackagesBusiness = Prisma.BusinessGetPayload<{
  include: typeof packagesBusinessInclude
}>

// NOTE: NO usar `relationLoadStrategy: 'join'` acá (ver nota arriba sobre el
// panic de Prisma 5.22 con includes anidados).
export const getPackagesBusinessBySlug = unstable_cache(async (slug: string) => {
  const business = await prisma.business.findUnique({
    where: { slug },
    include: packagesBusinessInclude,
  })

  return business?.isActive ? business : null
}, ['packages-business-by-slug'], { revalidate: 60, tags: ['packages-business-by-slug'] })

export const getPackagesBusinessBySubdomain = unstable_cache(async (subdomain: string) => {
  const business = await prisma.business.findUnique({
    where: { subdomain },
    include: packagesBusinessInclude,
  })

  return business?.isActive ? business : null
}, ['packages-business-by-subdomain'], { revalidate: 60, tags: ['packages-business-by-subdomain'] })