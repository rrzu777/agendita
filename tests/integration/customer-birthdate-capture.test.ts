import { PrismaClient } from '@prisma/client'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { requireTestDatabase } from './setup'
import { findOrCreateCustomerInTx } from '@/lib/customers/find-or-create'

requireTestDatabase()

const BIZ = 'cbd-biz-1'
const OWNER_USER = 'cbd-owner-1'

describe('captura de birthDate en findOrCreateCustomerInTx', () => {
  let prisma: PrismaClient

  async function cleanup(db: PrismaClient) {
    await db.customer.deleteMany({ where: { businessId: BIZ } })
    await db.businessUser.deleteMany({ where: { businessId: BIZ } })
    await db.business.deleteMany({ where: { id: BIZ } })
    await db.user.deleteMany({ where: { id: OWNER_USER } })
  }

  beforeAll(async () => {
    prisma = new PrismaClient()
    await cleanup(prisma)

    await prisma.user.create({ data: { id: OWNER_USER, email: 'owner@cbd.test', name: 'CBD Owner' } })
    await prisma.business.create({
      data: {
        id: BIZ, name: 'CBD Biz', slug: 'cbd-biz', subdomain: 'cbdbiz', ownerUserId: OWNER_USER,
        city: 'Santiago', country: 'CL', currency: 'CLP', timezone: 'America/Santiago', bookingWindowDays: 90,
      },
    })
    await prisma.businessUser.create({ data: { id: 'cbd-bu-1', businessId: BIZ, userId: OWNER_USER, role: 'owner' } })
  })

  afterAll(async () => {
    await cleanup(prisma)
    await prisma.$disconnect()
  })

  it('setea birthDate al crear y NO pisa la existente', async () => {
    const bd = new Date('1990-05-10T00:00:00Z')
    const { customer, created } = await prisma.$transaction((tx) =>
      findOrCreateCustomerInTx(tx, { businessId: BIZ, phone: '+56911111111', name: 'Nueva', birthDate: bd }))
    expect(created).toBe(true)
    expect(customer.birthDate?.toISOString().slice(0, 10)).toBe('1990-05-10')

    // Existente CON birthDate: un nuevo valor NO la pisa.
    const { customer: c2, created: created2 } = await prisma.$transaction((tx) =>
      findOrCreateCustomerInTx(tx, {
        businessId: BIZ, phone: '+56911111111', name: 'Nueva', birthDate: new Date('2000-01-01T00:00:00Z'),
      }))
    expect(created2).toBe(false)
    expect(c2.birthDate?.toISOString().slice(0, 10)).toBe('1990-05-10')

    const inDb = await prisma.customer.findUnique({ where: { id: customer.id } })
    expect(inDb!.birthDate?.toISOString().slice(0, 10)).toBe('1990-05-10')
  })

  it('backfill: existente SIN birthDate lo recibe', async () => {
    await prisma.customer.create({
      // Teléfono ya normalizado (como lo guarda findOrCreateCustomerInTx) para que el matcher lo encuentre.
      data: { id: 'cbd-cust-2', businessId: BIZ, name: 'Sin Fecha', phone: '56922222222' },
    })
    const bd = new Date('1985-12-24T00:00:00Z')
    const { customer, created } = await prisma.$transaction((tx) =>
      findOrCreateCustomerInTx(tx, { businessId: BIZ, phone: '+56922222222', name: 'Sin Fecha', birthDate: bd }))
    expect(created).toBe(false)
    expect(customer.birthDate?.toISOString().slice(0, 10)).toBe('1985-12-24')

    const inDb = await prisma.customer.findUnique({ where: { id: 'cbd-cust-2' } })
    expect(inDb!.birthDate?.toISOString().slice(0, 10)).toBe('1985-12-24')
  })
})
