import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { prisma } from '@/lib/db'
import { getEffectiveBlocks } from '@/lib/availability/effective-blocks'
import { resolveAvailabilityRules, resolveDayRule } from '@/lib/availability/scope'
import { assertSlotFreeOfConflicts } from '@/lib/availability/validation'
import { requireTestDatabase } from './setup'

requireTestDatabase()

// Lo que sólo la base puede probar de este PR:
//
// 1. que el filtro por persona esté en las DOS queries de bloqueos y también en la
//    PROYECCIÓN (un professionalId que muere en el .map deja los recurrentes sin
//    dueño y no hay forma de verlo desde un test de unidad);
// 2. que el SQL CRUDO del solape —reescrito acá para componer fragmentos en vez de
//    repetir el SELECT por cada combinación de cláusulas— siga rechazando y
//    aceptando lo mismo. Es la única red de esa reescritura;
// 3. que la herencia del horario funcione contra filas de verdad.
//
// Negocio desechable propio y no el del seed compartido: esta suite crea gente,
// reglas y reservas, y la base es compartida con las demás.

const BIZ = 'avail-persona-biz'
const OWNER = 'avail-persona-owner'
const TZ = 'America/Santiago'

// 2029-06-04 es lunes (dayOfWeek 1) y junio en Santiago es UTC-4 sin cambio de
// hora, así que 15:00Z = 11:00 local, adentro de una regla 09:00-18:00.
const LUNES_11 = new Date('2029-06-04T15:00:00Z')
const LUNES_12 = new Date('2029-06-04T16:00:00Z')
const DIA_DESDE = new Date('2029-06-04T04:00:00Z')
const DIA_HASTA = new Date('2029-06-05T03:59:59Z')

let juan = ''
let ana = ''
let serviceId = ''
let customerId = ''

async function limpiar() {
  // Las reservas primero: la FK de Booking a Professional es NO ACTION, así que una
  // reserva que todavía apunte a alguien hace fallar el borrado. Si una corrida
  // anterior murió a mitad, sin esto el beforeAll explota con un error de FK que no
  // dice nada del test que se está escribiendo.
  await prisma.booking.deleteMany({ where: { businessId: BIZ } })
  await prisma.timeBlockSeries.deleteMany({ where: { businessId: BIZ } })
  await prisma.timeBlock.deleteMany({ where: { businessId: BIZ } })
  await prisma.availabilityRule.deleteMany({ where: { businessId: BIZ } })
  await prisma.professional.deleteMany({ where: { businessId: BIZ } })
  await prisma.business.deleteMany({ where: { id: BIZ } })
  await prisma.user.deleteMany({ where: { id: OWNER } })
}

beforeAll(async () => {
  await limpiar()
  await prisma.user.create({ data: { id: OWNER, email: 'avail-persona@test.test', name: 'Dueña' } })
  await prisma.business.create({
    data: {
      id: BIZ,
      name: 'Barbería Alcance',
      slug: 'avail-persona-biz',
      subdomain: 'availpersona',
      ownerUserId: OWNER,
      city: 'Santiago',
      timezone: TZ,
    },
  })
  const service = await prisma.service.create({
    data: { businessId: BIZ, name: 'Corte', durationMinutes: 60, price: 20000, depositAmount: 0, pastelColor: '#FFD700' },
  })
  serviceId = service.id
  const customer = await prisma.customer.create({
    data: { businessId: BIZ, name: 'Clienta', phone: '+56911112222' },
  })
  customerId = customer.id
  juan = (await prisma.professional.create({ data: { businessId: BIZ, name: 'Juan' } })).id
  ana = (await prisma.professional.create({ data: { businessId: BIZ, name: 'Ana' } })).id

  // El horario del negocio: lunes 09:00-18:00. Nadie tiene horario propio todavía.
  await prisma.availabilityRule.create({
    data: { businessId: BIZ, dayOfWeek: 1, startTime: '09:00', endTime: '18:00', isActive: true },
  })
})

afterAll(async () => {
  await limpiar()
  await prisma.$disconnect()
})

async function bloques(scope: Parameters<typeof getEffectiveBlocks>[0]['scope']) {
  return getEffectiveBlocks({
    businessId: BIZ,
    rangeStart: DIA_DESDE,
    rangeEnd: DIA_HASTA,
    timezone: TZ,
    scope,
  })
}

describe('bloqueos por persona', () => {
  afterAll(async () => {
    await prisma.timeBlockSeries.deleteMany({ where: { businessId: BIZ } })
    await prisma.timeBlock.deleteMany({ where: { businessId: BIZ } })
  })

  it('las vacaciones de una persona NO cierran el local', async () => {
    await prisma.timeBlock.create({
      data: { businessId: BIZ, professionalId: juan, startDateTime: LUNES_11, endDateTime: LUNES_12, reason: 'Vacaciones de Juan' },
    })

    const delNegocio = await bloques({ kind: 'business' })
    expect(delNegocio.map((b) => b.reason)).not.toContain('Vacaciones de Juan')

    // A Juan sí lo deja sin atender…
    const deJuan = await bloques({ kind: 'professional', professionalId: juan })
    expect(deJuan.map((b) => b.reason)).toContain('Vacaciones de Juan')

    // …y a Ana no le toca la agenda.
    const deAna = await bloques({ kind: 'professional', professionalId: ana })
    expect(deAna.map((b) => b.reason)).not.toContain('Vacaciones de Juan')
  })

  it('el feriado del salón cierra para todos', async () => {
    await prisma.timeBlock.create({
      data: { businessId: BIZ, professionalId: null, startDateTime: LUNES_11, endDateTime: LUNES_12, reason: 'Feriado' },
    })

    for (const scope of [
      { kind: 'business' } as const,
      { kind: 'professional', professionalId: juan } as const,
      { kind: 'professional', professionalId: ana } as const,
    ]) {
      const b = await bloques(scope)
      expect(b.map((x) => x.reason), JSON.stringify(scope)).toContain('Feriado')
    }
  })

  it('everyone los trae todos, que es lo que necesita el calendario', async () => {
    await prisma.timeBlock.create({
      data: { businessId: BIZ, professionalId: juan, startDateTime: LUNES_11, endDateTime: LUNES_12, reason: 'De Juan' },
    })
    await prisma.timeBlock.create({
      data: { businessId: BIZ, professionalId: ana, startDateTime: LUNES_11, endDateTime: LUNES_12, reason: 'De Ana' },
    })

    const todos = (await bloques({ kind: 'everyone' })).map((b) => b.reason)
    expect(todos).toContain('De Juan')
    expect(todos).toContain('De Ana')
  })

  // El trap: EffectiveBlock es un tipo PROYECTADO y se arma en dos lugares. Un
  // professionalId que entre al filtro pero no a la proyección de expandSeries deja
  // los recurrentes sin dueño, y el calendario no puede distinguir el feriado del
  // salón de las vacaciones de una persona.
  it('un bloqueo RECURRENTE de una persona llega con su dueño puesto', async () => {
    await prisma.timeBlockSeries.create({
      data: {
        businessId: BIZ,
        professionalId: juan,
        daysOfWeek: [1],
        startTime: '11:00',
        endTime: '12:00',
        reason: 'Almuerzo de Juan',
        anchorDate: DIA_DESDE,
        until: null,
        isActive: true,
      },
    })

    const ocurrencia = (await bloques({ kind: 'everyone' })).find((b) => b.reason === 'Almuerzo de Juan')
    expect(ocurrencia).toBeDefined()
    expect(ocurrencia!.professionalId).toBe(juan)
    expect(ocurrencia!.seriesId).toBeTruthy()

    // Y el filtro de la query de series también lo respeta.
    const deAna = await bloques({ kind: 'professional', professionalId: ana })
    expect(deAna.map((b) => b.reason)).not.toContain('Almuerzo de Juan')
  })
})

describe('herencia del horario contra filas de verdad', () => {
  afterAll(async () => {
    await prisma.availabilityRule.deleteMany({ where: { businessId: BIZ, professionalId: { not: null } } })
  })

  it('sin filas propias, una persona atiende en el horario del salón', async () => {
    const rules = await resolveAvailabilityRules(prisma, BIZ, juan)
    expect(rules).toHaveLength(1)
    expect(rules[0].professionalId).toBeNull()
    expect(await resolveDayRule(prisma, BIZ, juan, 1)).toMatchObject({ startTime: '09:00' })
  })

  it('con una sola fila propia deja de heredar, incluso los días que no tiene', async () => {
    await prisma.availabilityRule.create({
      data: { businessId: BIZ, professionalId: juan, dayOfWeek: 6, startTime: '10:00', endTime: '14:00', isActive: true },
    })

    const rules = await resolveAvailabilityRules(prisma, BIZ, juan)
    expect(rules.map((r) => r.dayOfWeek)).toEqual([6])
    // El lunes del negocio ya no es suyo: sólo trabaja sábados.
    expect(await resolveDayRule(prisma, BIZ, juan, 1)).toBeNull()
    // Y a Ana, que no tiene nada propio, no le cambió nada.
    expect(await resolveDayRule(prisma, BIZ, ana, 1)).toMatchObject({ startTime: '09:00' })
  })

  it('una persona con su única fila cerrada queda cerrada, no heredando', async () => {
    await prisma.availabilityRule.updateMany({
      where: { businessId: BIZ, professionalId: juan },
      data: { isActive: false },
    })
    expect(await resolveAvailabilityRules(prisma, BIZ, juan)).toEqual([])
    expect(await resolveDayRule(prisma, BIZ, juan, 1)).toBeNull()
  })
})

// Estos cuatro son la red del SQL crudo reescrito.
describe('solape de reservas por persona', () => {
  let reservaDeAna = ''

  beforeAll(async () => {
    reservaDeAna = (
      await prisma.booking.create({
        data: {
          businessId: BIZ,
          serviceId,
          customerId,
          professionalId: ana,
          startDateTime: LUNES_11,
          endDateTime: LUNES_12,
          status: 'confirmed',
          totalPrice: 20000,
          depositRequired: 0,
          remainingBalance: 20000,
          finalAmount: 20000,
          paymentStatus: 'unpaid',
        },
      })
    ).id
  })

  afterAll(async () => {
    await prisma.booking.deleteMany({ where: { businessId: BIZ } })
  })

  const slot = { startDateTime: LUNES_11, endDateTime: LUNES_12, timezone: TZ, businessId: BIZ }

  it('la cita de Ana no le ocupa la hora a Juan', async () => {
    await expect(
      prisma.$transaction((tx) => assertSlotFreeOfConflicts({ tx, ...slot, professionalId: juan })),
    ).resolves.toBeUndefined()
  })

  it('la cita de Ana sí le ocupa la hora a Ana', async () => {
    await expect(
      prisma.$transaction((tx) => assertSlotFreeOfConflicts({ tx, ...slot, professionalId: ana })),
    ).rejects.toThrow('Ese horario ya no está disponible')
  })

  // El modo negocio cuenta TODAS las reservas y no sólo las sin persona: dar de baja
  // al equipo no puede volver invisibles las citas que ya tenía, o se reservaría
  // encima de una cita real.
  it('sin persona choca contra la cita de Ana igual', async () => {
    await expect(
      prisma.$transaction((tx) => assertSlotFreeOfConflicts({ tx, ...slot, professionalId: null })),
    ).rejects.toThrow('Ese horario ya no está disponible')
  })

  it('excludeBookingId sigue funcionando junto con el filtro de persona', async () => {
    await expect(
      prisma.$transaction((tx) =>
        assertSlotFreeOfConflicts({ tx, ...slot, professionalId: ana, excludeBookingId: reservaDeAna }),
      ),
    ).resolves.toBeUndefined()
  })

  // Una reserva SIN persona es de antes de que el negocio tuviera equipo: no
  // sabemos quién la iba a atender, así que le bloquea la hora a cualquiera.
  it('una cita sin persona le ocupa la hora a todos', async () => {
    await prisma.booking.updateMany({ where: { id: reservaDeAna }, data: { professionalId: null } })

    for (const persona of [juan, ana, null]) {
      await expect(
        prisma.$transaction((tx) => assertSlotFreeOfConflicts({ tx, ...slot, professionalId: persona })),
        String(persona),
      ).rejects.toThrow('Ese horario ya no está disponible')
    }
  })
})
