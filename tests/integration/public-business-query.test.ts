import { PrismaClient } from '@prisma/client'
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { requireTestDatabase } from './setup'

requireTestDatabase()

// unstable_cache passthrough: queremos ejercitar la query real (sin caché) para
// que el test dispare el engine de Prisma de verdad, no un valor cacheado.
vi.mock('next/cache', () => ({
  unstable_cache: (fn: (...args: unknown[]) => unknown) => fn,
}))

// Import DESPUÉS del mock (los módulos llaman unstable_cache al evaluarse).
import {
  getPublicBusinessBySlug,
  getPublicBusinessBySubdomain,
  getBookingBusinessBySlug,
} from '@/lib/business/public'

const prisma = new PrismaClient()
const SLUG = 'pbq-biz'
const SUB = 'pbqbiz'
const USER = 'pbq-user'

describe('public business queries (regresión panic Prisma join)', () => {
  beforeAll(async () => {
    await prisma.review.deleteMany({ where: { business: { slug: SLUG } } })
    await prisma.availabilityRule.deleteMany({ where: { business: { slug: SLUG } } })
    await prisma.service.deleteMany({ where: { business: { slug: SLUG } } })
    await prisma.customer.deleteMany({ where: { business: { slug: SLUG } } })
    await prisma.business.deleteMany({ where: { slug: SLUG } })
    await prisma.user.deleteMany({ where: { id: USER } })

    const user = await prisma.user.create({ data: { id: USER, email: 'pbq@example.cl' } })
    const business = await prisma.business.create({
      data: {
        slug: SLUG, subdomain: SUB, name: 'PBQ Studio', ownerUserId: user.id,
        city: 'Santiago', country: 'CL', currency: 'CLP', timezone: 'America/Santiago',
        bookingWindowDays: 90, isActive: true,
      },
    })
    await prisma.service.create({
      data: { businessId: business.id, name: 'Servicio PBQ', durationMinutes: 45, price: 10000, depositAmount: 0, pastelColor: '#F8C8DC', isActive: true },
    })
    await prisma.availabilityRule.create({
      data: { businessId: business.id, dayOfWeek: 1, startTime: '09:00', endTime: '18:00', isActive: true },
    })
    // No hace falta poblar reviews: el include las referencia (+ _count) igual, y
    // el panic del engine ocurre al construir el query-document, no al leer filas.
  })

  afterAll(async () => {
    await prisma.availabilityRule.deleteMany({ where: { business: { slug: SLUG } } })
    await prisma.service.deleteMany({ where: { business: { slug: SLUG } } })
    await prisma.business.deleteMany({ where: { slug: SLUG } })
    await prisma.user.deleteMany({ where: { id: USER } })
    await prisma.$disconnect()
  })

  // Con relationLoadStrategy:'join' este include hace panic del query engine
  // (Prisma 5.22) — 100% reproducible bajo concurrencia. La estrategia default no.
  it('resuelve el perfil público por slug bajo concurrencia sin panic', async () => {
    const results = await Promise.all(Array.from({ length: 12 }, () => getPublicBusinessBySlug(SLUG)))
    for (const biz of results) {
      expect(biz).not.toBeNull()
      expect(biz?.slug).toBe(SLUG)
    }
  })

  it('resuelve el perfil público por subdominio sin panic', async () => {
    const biz = await getPublicBusinessBySubdomain(SUB)
    expect(biz?.subdomain).toBe(SUB)
  })

  it('resuelve el negocio de reserva por slug sin panic', async () => {
    const biz = await getBookingBusinessBySlug(SLUG)
    expect(biz?.slug).toBe(SLUG)
  })
})
