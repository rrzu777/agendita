import { PrismaClient, Prisma } from '@prisma/client'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { requireTestDatabase } from './setup'
import { findOrCreateCustomerInTx } from '@/lib/customers/find-or-create'

requireTestDatabase()

const BIZ_A = 'cpu-biz-a'
const BIZ_B = 'cpu-biz-b'
const OWNER_USER = 'cpu-owner-1'
const PHONE = '56977777777'

/**
 * La constraint `@@unique([businessId, phone])` es defensa en profundidad detrás
 * del advisory lock de findOrCreateCustomerInTx: el lock serializa el
 * find-or-create, y esto ataja cualquier camino que se saltee esa función.
 *
 * Vale la pena testearla porque una constraint que nadie ejercita es una
 * constraint que nadie sabe si está puesta. En prod llegaron a existir 8 fichas
 * con el mismo teléfono (artefactos de e2e, borradas) justamente porque no había
 * nada a nivel DB que lo impidiera.
 */
describe('unicidad de Customer por (businessId, phone)', () => {
  let prisma: PrismaClient

  async function cleanup(db: PrismaClient) {
    await db.customer.deleteMany({ where: { businessId: { in: [BIZ_A, BIZ_B] } } })
    await db.businessUser.deleteMany({ where: { businessId: { in: [BIZ_A, BIZ_B] } } })
    await db.business.deleteMany({ where: { id: { in: [BIZ_A, BIZ_B] } } })
    await db.user.deleteMany({ where: { id: OWNER_USER } })
  }

  beforeAll(async () => {
    prisma = new PrismaClient()
    await cleanup(prisma)

    await prisma.user.create({ data: { id: OWNER_USER, email: 'owner@cpu.test', name: 'CPU Owner' } })
    for (const [id, slug] of [[BIZ_A, 'cpu-biz-a'], [BIZ_B, 'cpu-biz-b']]) {
      await prisma.business.create({
        data: {
          id, name: id, slug, subdomain: slug.replace(/-/g, ''), ownerUserId: OWNER_USER,
          city: 'Santiago', country: 'CL', currency: 'CLP', timezone: 'America/Santiago', bookingWindowDays: 90,
        },
      })
    }
  })

  afterAll(async () => {
    await cleanup(prisma)
    await prisma.$disconnect()
  })

  it('la DB rechaza una segunda ficha con el mismo teléfono en el mismo negocio', async () => {
    await prisma.customer.create({ data: { businessId: BIZ_A, name: 'Primera', phone: PHONE } })

    const err = await prisma.customer
      .create({ data: { businessId: BIZ_A, name: 'Segunda', phone: PHONE } })
      .catch((e: unknown) => e)

    expect(err).toBeInstanceOf(Prisma.PrismaClientKnownRequestError)
    expect((err as Prisma.PrismaClientKnownRequestError).code).toBe('P2002')
  })

  it('el mismo teléfono en OTRO negocio sí se permite', async () => {
    const otra = await prisma.customer.create({ data: { businessId: BIZ_B, name: 'De otro negocio', phone: PHONE } })
    expect(otra.businessId).toBe(BIZ_B)
  })

  it('findOrCreateCustomerInTx sigue devolviendo la existente en vez de chocar', async () => {
    // El teléfono llega con formato distinto: normalizePhone lo lleva al mismo
    // valor guardado, así que matchea la ficha del primer caso.
    const { customer, created } = await prisma.$transaction((tx) =>
      findOrCreateCustomerInTx(tx, { businessId: BIZ_A, phone: `+${PHONE}`, name: 'Primera' }))

    expect(created).toBe(false)
    expect(customer.name).toBe('Primera')
    expect(await prisma.customer.count({ where: { businessId: BIZ_A, phone: PHONE } })).toBe(1)
  })
})
