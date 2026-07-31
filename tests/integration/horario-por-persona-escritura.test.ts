import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { materializeProfessionalSchedule } from '@/lib/availability/weekly-schedule'
import { resolveAvailabilityRules, resolveRuleScope } from '@/lib/availability/scope'
import { requireTestDatabase } from './setup'

requireTestDatabase()

// Lo que sólo la base puede probar de la ESCRITURA del horario por persona:
//
// 1. que materializar y leer estén de acuerdo — la copia la escribe una función y la
//    herencia la resuelve otra, y un test de unidad con mocks las mira por separado;
// 2. que el advisory lock impida de verdad la doble copia con dos transacciones
//    concurrentes (`AvailabilityRule` NO tiene unique sobre (negocio, persona, día):
//    si el lock no sirve, quedan 14 filas y nadie se entera);
// 3. que soltar el horario propio devuelva a la persona al del salón, con filas reales.
//
// Negocio desechable propio: la base es compartida con las demás suites.

const BIZ = 'horario-escritura-biz'
const OWNER = 'horario-escritura-owner'
const TZ = 'America/Santiago'

let juan = ''
let ana = ''

async function limpiar() {
  await prisma.availabilityRule.deleteMany({ where: { businessId: BIZ } })
  await prisma.professional.deleteMany({ where: { businessId: BIZ } })
  await prisma.business.deleteMany({ where: { id: BIZ } })
  await prisma.user.deleteMany({ where: { id: OWNER } })
}

beforeAll(async () => {
  await limpiar()
  await prisma.user.create({ data: { id: OWNER, email: 'horario-escritura@test.test', name: 'Dueña' } })
  await prisma.business.create({
    data: {
      id: BIZ,
      name: 'Barbería Escritura',
      slug: 'horario-escritura-biz',
      subdomain: 'horarioescritura',
      ownerUserId: OWNER,
      city: 'Santiago',
      timezone: TZ,
    },
  })
  juan = (await prisma.professional.create({ data: { businessId: BIZ, name: 'Juan' } })).id
  ana = (await prisma.professional.create({ data: { businessId: BIZ, name: 'Ana' } })).id
})

afterAll(async () => {
  await limpiar()
  await prisma.$disconnect()
})

// El horario del salón: lunes a viernes 09–18, sábado cerrado, domingo sin fila.
async function sembrarHorarioDelSalon() {
  await prisma.availabilityRule.deleteMany({ where: { businessId: BIZ } })
  await prisma.availabilityRule.createMany({
    data: [
      { businessId: BIZ, dayOfWeek: 1, startTime: '09:00', endTime: '18:00', isActive: true },
      { businessId: BIZ, dayOfWeek: 2, startTime: '09:00', endTime: '18:00', isActive: true },
      { businessId: BIZ, dayOfWeek: 3, startTime: '09:00', endTime: '18:00', isActive: true },
      { businessId: BIZ, dayOfWeek: 4, startTime: '09:00', endTime: '18:00', isActive: true },
      { businessId: BIZ, dayOfWeek: 5, startTime: '09:00', endTime: '18:00', isActive: true },
      { businessId: BIZ, dayOfWeek: 6, startTime: '10:00', endTime: '15:00', isActive: false },
    ],
  })
}

beforeEach(sembrarHorarioDelSalon)

describe('materializar el horario de una persona', () => {
  it('le copia la semana entera y a partir de ahí deja de heredar', async () => {
    expect(await resolveRuleScope(prisma, BIZ, juan)).toBeNull()

    await prisma.$transaction((tx) => materializeProfessionalSchedule(tx, BIZ, juan))

    const propias = await prisma.availabilityRule.findMany({ where: { businessId: BIZ, professionalId: juan } })
    expect(propias).toHaveLength(7)
    expect(await resolveRuleScope(prisma, BIZ, juan)).toBe(juan)
  })

  /**
   * El día que el salón no tiene sale CERRADO, no abierto. Contra la base porque acá
   * se ve la consecuencia de verdad: `resolveAvailabilityRules` filtra `isActive`, así
   * que el domingo materializado tiene que desaparecer de las reglas que rigen.
   */
  it('el domingo que el salón no tiene queda cerrado, no abierto', async () => {
    await prisma.$transaction((tx) => materializeProfessionalSchedule(tx, BIZ, juan))

    const domingo = await prisma.availabilityRule.findFirst({
      where: { businessId: BIZ, professionalId: juan, dayOfWeek: 0 },
    })
    expect(domingo?.isActive).toBe(false)

    const rigen = await resolveAvailabilityRules(prisma, BIZ, juan)
    expect(rigen.map((r) => r.dayOfWeek)).toEqual([1, 2, 3, 4, 5])
  })

  it('no toca el horario del salón ni el de la otra persona', async () => {
    await prisma.$transaction((tx) => materializeProfessionalSchedule(tx, BIZ, juan))

    const delSalon = await prisma.availabilityRule.count({ where: { businessId: BIZ, professionalId: null } })
    expect(delSalon).toBe(6)
    expect(await resolveRuleScope(prisma, BIZ, ana)).toBeNull()
  })

  it('es idempotente: llamarla de nuevo no duplica nada', async () => {
    await prisma.$transaction((tx) => materializeProfessionalSchedule(tx, BIZ, juan))
    await prisma.$transaction((tx) => materializeProfessionalSchedule(tx, BIZ, juan))

    const propias = await prisma.availabilityRule.count({ where: { businessId: BIZ, professionalId: juan } })
    expect(propias).toBe(7)
  })

  /**
   * Dos pestañas guardando dos días distintos a la vez. Sin el advisory lock las dos
   * leen "no tiene horario propio" y copian la semana: 14 filas, la mitad de los días
   * con dos horarios, y ningún error — no hay unique que lo atrape.
   */
  it('dos transacciones a la vez copian la semana UNA sola vez', async () => {
    await Promise.all([
      prisma.$transaction((tx) => materializeProfessionalSchedule(tx, BIZ, juan)),
      prisma.$transaction((tx) => materializeProfessionalSchedule(tx, BIZ, juan)),
    ])

    const propias = await prisma.availabilityRule.count({ where: { businessId: BIZ, professionalId: juan } })
    expect(propias).toBe(7)
  })
})

describe('soltar el horario propio', () => {
  it('vuelve a heredar el del salón, y hereda los cambios posteriores', async () => {
    await prisma.$transaction((tx) => materializeProfessionalSchedule(tx, BIZ, juan))
    await prisma.availabilityRule.updateMany({
      where: { businessId: BIZ, professionalId: juan, dayOfWeek: 1 },
      data: { startTime: '14:00', endTime: '20:00' },
    })

    const propio = await resolveAvailabilityRules(prisma, BIZ, juan)
    expect(propio.find((r) => r.dayOfWeek === 1)?.startTime).toBe('14:00')

    await prisma.availabilityRule.deleteMany({ where: { businessId: BIZ, professionalId: juan } })

    // Vuelve al del salón…
    const heredado = await resolveAvailabilityRules(prisma, BIZ, juan)
    expect(heredado.find((r) => r.dayOfWeek === 1)?.startTime).toBe('09:00')

    // …y sigue el salón hacia adelante, que es la razón de ser de la herencia.
    await prisma.availabilityRule.updateMany({
      where: { businessId: BIZ, professionalId: null, dayOfWeek: 1 },
      data: { startTime: '08:00' },
    })
    const despues = await resolveAvailabilityRules(prisma, BIZ, juan)
    expect(despues.find((r) => r.dayOfWeek === 1)?.startTime).toBe('08:00')
  })

  /**
   * El borde que invierte el sentido de la herencia: cerrarle la semana entera a
   * alguien tiene que dejarlo CERRADO, no devolverlo al horario del salón. Por eso
   * `resolveRuleScope` pregunta por la existencia sin filtrar `isActive`.
   */
  it('cerrarle todos los días la deja cerrada, no abierta en el horario del salón', async () => {
    await prisma.$transaction((tx) => materializeProfessionalSchedule(tx, BIZ, juan))
    await prisma.availabilityRule.updateMany({
      where: { businessId: BIZ, professionalId: juan },
      data: { isActive: false },
    })

    expect(await resolveRuleScope(prisma, BIZ, juan)).toBe(juan)
    expect(await resolveAvailabilityRules(prisma, BIZ, juan)).toHaveLength(0)
  })
})
