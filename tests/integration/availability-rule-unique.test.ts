import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { requireTestDatabase } from './setup'

requireTestDatabase()

/**
 * Los dos índices parciales que garantizan UNA regla de horario por
 * (negocio, alcance, día) viven sólo en el `.sql` de la migración
 * `availability_rule_unique`: Prisma no expresa índices parciales, así que
 * `schema.prisma` no los menciona y esto es su única red — igual que el EXCLUDE
 * `Booking_no_overlap`.
 *
 * Dos motivos para que este archivo exista:
 *
 * 1. **Que sigan ahí.** Si una migración futura los borra (o alguien regenera
 *    la base desde el schema, que no los tiene), el primer test lo grita. Sin
 *    esto la pérdida es invisible hasta que aparezcan filas duplicadas.
 * 2. **Que muerdan donde tienen que morder.** El caso peligroso es el del
 *    horario DEL NEGOCIO: un unique plano sobre las tres columnas NO lo cubre,
 *    porque adentro de un índice dos NULL nunca son iguales. Ese es el tercer
 *    test, y es el que falla si alguien "simplifica" los parciales a un
 *    `@@unique` de Prisma.
 *
 * Negocio desechable propio: la base es compartida y nadie más la limpia.
 */

const BIZ = 'availability-unique-biz'
const OWNER = 'availability-unique-owner'

let ana = ''

async function limpiar() {
  await prisma.availabilityRule.deleteMany({ where: { businessId: BIZ } })
  await prisma.professional.deleteMany({ where: { businessId: BIZ } })
  await prisma.business.deleteMany({ where: { id: BIZ } })
  await prisma.user.deleteMany({ where: { id: OWNER } })
}

beforeAll(async () => {
  await limpiar()
  await prisma.user.create({ data: { id: OWNER, email: 'availability-unique@test.test', name: 'Dueña' } })
  await prisma.business.create({
    data: {
      id: BIZ,
      name: 'Barbería Unique',
      slug: BIZ,
      subdomain: 'availabilityunique',
      ownerUserId: OWNER,
      city: 'Santiago',
      timezone: 'America/Santiago',
    },
  })
  ana = (await prisma.professional.create({ data: { businessId: BIZ, name: 'Ana' } })).id
})

beforeEach(async () => {
  await prisma.availabilityRule.deleteMany({ where: { businessId: BIZ } })
})

afterAll(async () => {
  await limpiar()
  await prisma.$disconnect()
})

/** Un día cualquiera; el negocio es propio así que no pisa a nadie. */
const LUNES = 1

function regla(professionalId: string | null, dayOfWeek = LUNES) {
  return prisma.availabilityRule.create({
    data: { businessId: BIZ, professionalId, dayOfWeek, startTime: '09:00', endTime: '18:00' },
  })
}

describe('los índices únicos de AvailabilityRule', () => {
  it('los dos índices parciales existen en la base', async () => {
    const filas = await prisma.$queryRaw<{ indexname: string }[]>`
      SELECT indexname FROM pg_indexes WHERE tablename = 'AvailabilityRule'
    `
    const nombres = filas.map((f) => f.indexname)
    expect(nombres).toContain('AvailabilityRule_business_day_key')
    expect(nombres).toContain('AvailabilityRule_professional_day_key')
  })

  it('una persona no puede tener dos reglas para el mismo día', async () => {
    await regla(ana)
    await expect(regla(ana)).rejects.toThrow()
  })

  // EL caso que un `@@unique` de Prisma sobre las tres columnas NO cubriría:
  // con `professionalId` NULL, dos filas no chocarían nunca (dentro de un índice
  // los NULL son todos distintos) y el horario del negocio —el que tienen TODAS
  // las filas de hoy— quedaría sin protección.
  it('el horario del negocio tampoco puede duplicarse, aunque la persona sea NULL', async () => {
    await regla(null)
    await expect(regla(null)).rejects.toThrow()
  })

  it('el mismo día para el negocio y para una persona conviven', async () => {
    await regla(null)
    await expect(regla(ana)).resolves.toBeTruthy()
  })

  it('días distintos del mismo alcance conviven', async () => {
    await regla(ana, LUNES)
    await expect(regla(ana, LUNES + 1)).resolves.toBeTruthy()
  })
})
