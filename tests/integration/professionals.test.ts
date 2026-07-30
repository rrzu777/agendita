import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { prisma } from '@/lib/db'
import { requireTestDatabase } from './setup'
import {
  seedDeclaredTransfer,
  cleanupBankTransferSeed,
  BT_VERIFY_BIZ,
  BT_VERIFY_SVC,
} from './helpers/bank-transfer-seed'

requireTestDatabase()

// Lo que sólo la base puede probar. Los tests de unidad no ven un ON DELETE ni la
// forma de una columna de enums, y esta migración se escribió a mano, sin
// `migrate dev` — así que si está mal, estos casos son los que avisan.
//
// Lo importante son los dos del cascade: que borrar a una persona se lleve SU
// horario y deje intacto el del negocio (la propiedad que hace que la semántica de
// `null` sea segura), y que las reservas lo rechacen.

const P1 = 'prof-test-1'
const P2 = 'prof-test-2'

async function cleanupProfessionals() {
  await prisma.availabilityRule.deleteMany({ where: { businessId: BT_VERIFY_BIZ } })
  await prisma.timeBlock.deleteMany({ where: { businessId: BT_VERIFY_BIZ } })
  await prisma.professional.deleteMany({ where: { businessId: BT_VERIFY_BIZ } })
}

beforeAll(async () => {
  await seedDeclaredTransfer() // siembra el negocio y su servicio
  await cleanupProfessionals()
})

afterAll(async () => {
  await cleanupProfessionals()
  await cleanupBankTransferSeed()
  await prisma.$disconnect()
})

describe('Professional — la columna de modalidades', () => {
  it('sin modalidades explícitas queda en el local (default de la columna)', async () => {
    const created = await prisma.professional.create({
      data: { id: P1, businessId: BT_VERIFY_BIZ, name: 'Juan' },
    })
    expect(created.modalities).toEqual(['on_site'])
    expect(created.isActive).toBe(true)
  })

  it('guarda y devuelve varias modalidades', async () => {
    const updated = await prisma.professional.update({
      where: { id: P1 },
      data: { modalities: ['on_site', 'at_home'] },
    })
    expect(updated.modalities).toEqual(['on_site', 'at_home'])
  })
})

describe('Professional ↔ Service', () => {
  it('la relación va y vuelve', async () => {
    await prisma.professional.update({
      where: { id: P1 },
      data: { services: { connect: { id: BT_VERIFY_SVC } } },
    })

    const read = await prisma.professional.findUnique({
      where: { id: P1 },
      include: { services: { select: { id: true } } },
    })
    expect(read!.services.map((s) => s.id)).toEqual([BT_VERIFY_SVC])

    // Y desde el otro lado, que es como lo va a leer el funnel en el PR D.
    const service = await prisma.service.findUnique({
      where: { id: BT_VERIFY_SVC },
      include: { professionals: { select: { id: true } } },
    })
    expect(service!.professionals.map((p) => p.id)).toContain(P1)
  })

  // `set` y no `connect` es lo que hace que destildar un servicio lo desasigne de
  // verdad. Con `connect` la lista sólo crecería.
  it('set con lista vacía desasigna', async () => {
    await prisma.professional.update({
      where: { id: P1 },
      data: { services: { set: [] } },
    })
    const read = await prisma.professional.findUnique({
      where: { id: P1 },
      include: { services: true },
    })
    expect(read!.services).toEqual([])
  })
})

describe('professionalId en las cuatro tablas', () => {
  it('las filas que ya existían quedan en null, que es "del negocio"', async () => {
    const rule = await prisma.availabilityRule.create({
      data: { businessId: BT_VERIFY_BIZ, dayOfWeek: 1, startTime: '09:00', endTime: '18:00' },
    })
    expect(rule.professionalId).toBeNull()

    const block = await prisma.timeBlock.create({
      data: {
        businessId: BT_VERIFY_BIZ,
        startDateTime: new Date('2030-01-01T12:00:00Z'),
        endDateTime: new Date('2030-01-01T13:00:00Z'),
      },
    })
    expect(block.professionalId).toBeNull()

    // Las reservas que sembró el helper son de antes del equipo: sin persona.
    const booking = await prisma.booking.findFirst({
      where: { businessId: BT_VERIFY_BIZ },
      select: { professionalId: true },
    })
    expect(booking!.professionalId).toBeNull()
  })
})

describe('borrar a una persona', () => {
  it('se lleva SU horario y deja intacto el del negocio', async () => {
    await prisma.professional.create({
      data: { id: P2, businessId: BT_VERIFY_BIZ, name: 'Ana' },
    })
    const ownRule = await prisma.availabilityRule.create({
      data: {
        businessId: BT_VERIFY_BIZ,
        professionalId: P2,
        dayOfWeek: 2,
        startTime: '10:00',
        endTime: '16:00',
      },
    })
    const businessRules = await prisma.availabilityRule.count({
      where: { businessId: BT_VERIFY_BIZ, professionalId: null },
    })
    expect(businessRules).toBeGreaterThan(0)

    await prisma.professional.delete({ where: { id: P2 } })

    // La suya se fue con ella (CASCADE)…
    expect(await prisma.availabilityRule.findUnique({ where: { id: ownRule.id } })).toBeNull()
    // …y las del negocio siguen ahí. Es la propiedad que hace segura la semántica
    // de null: el cascade sólo alcanza a las filas que TIENEN professionalId.
    expect(
      await prisma.availabilityRule.count({
        where: { businessId: BT_VERIFY_BIZ, professionalId: null },
      }),
    ).toBe(businessRules)
  })

  it('la base lo rechaza si tiene una reserva a su nombre', async () => {
    const booking = await prisma.booking.findFirst({
      where: { businessId: BT_VERIFY_BIZ },
      select: { id: true },
    })
    await prisma.booking.update({
      where: { id: booking!.id },
      data: { professionalId: P1 },
    })

    await expect(prisma.professional.delete({ where: { id: P1 } })).rejects.toThrow()

    // Sigue existiendo: el rechazo no dejó nada a medias.
    expect(await prisma.professional.findUnique({ where: { id: P1 } })).not.toBeNull()

    // Se desengancha para que el cleanup pueda borrar.
    await prisma.booking.update({
      where: { id: booking!.id },
      data: { professionalId: null },
    })
  })

  // Este caso es el que justifica que la FK sea NO ACTION y no RESTRICT. Los dos
  // rechazan el borrado directo, pero al borrar un Business, Postgres cascadea a
  // Booking y a Professional en el MISMO statement y sin orden garantizado:
  // RESTRICT se chequea de inmediato y haría explotar el borrado del negocio si le
  // toca la persona antes que sus reservas. NO ACTION chequea al final, cuando la
  // cascada ya limpió las reservas.
  //
  // Negocio propio y desechable: no se puede borrar el del seed en medio de la
  // suite.
  it('borrar el negocio entero funciona igual, con gente que tiene reservas', async () => {
    const BIZ = 'prof-cascade-biz'
    const OWNER = 'prof-cascade-owner'

    await prisma.user.create({
      data: { id: OWNER, email: 'prof-cascade@test.test', name: 'Dueña' },
    })
    await prisma.business.create({
      data: {
        id: BIZ,
        name: 'Salón Cascada',
        slug: 'prof-cascade-biz',
        subdomain: 'profcascade',
        ownerUserId: OWNER,
        city: 'Santiago',
      },
    })
    const service = await prisma.service.create({
      data: {
        businessId: BIZ,
        name: 'Corte',
        durationMinutes: 60,
        price: 20000,
        depositAmount: 0,
        pastelColor: '#FFD700',
      },
    })
    const professional = await prisma.professional.create({
      data: { businessId: BIZ, name: 'Juan' },
    })
    const customer = await prisma.customer.create({
      data: { businessId: BIZ, name: 'Ana', phone: '+56911119999' },
    })
    const start = new Date('2030-06-01T15:00:00Z')
    await prisma.booking.create({
      data: {
        businessId: BIZ,
        serviceId: service.id,
        customerId: customer.id,
        professionalId: professional.id,
        startDateTime: start,
        endDateTime: new Date('2030-06-01T16:00:00Z'),
        status: 'confirmed',
        totalPrice: 20000,
        depositRequired: 0,
        remainingBalance: 20000,
        finalAmount: 20000,
        paymentStatus: 'unpaid',
      },
    })

    await expect(prisma.business.delete({ where: { id: BIZ } })).resolves.toBeTruthy()

    expect(await prisma.professional.count({ where: { businessId: BIZ } })).toBe(0)
    expect(await prisma.booking.count({ where: { businessId: BIZ } })).toBe(0)

    await prisma.user.delete({ where: { id: OWNER } })
  })
})
