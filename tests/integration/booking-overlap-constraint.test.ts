import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import type { BookingStatus } from '@prisma/client'
import { addMinutes } from 'date-fns'
import { prisma } from '@/lib/db'
import { requireTestDatabase } from './setup'

requireTestDatabase()

/**
 * El EXCLUDE `Booking_no_overlap` no existe en `schema.prisma` —el lenguaje de Prisma
 * no lo expresa— así que su única definición es un `.sql` y su única red es esto. Un
 * test de unidad no puede ver un constraint.
 *
 * Los tres casos son las tres cosas que la migración `booking_overlap_por_persona`
 * tiene que cumplir a la vez, y la tercera es la peligrosa: el constraint separa por
 * `COALESCE("professionalId", '')` justamente porque adentro de un EXCLUDE dos NULL
 * nunca chocan. Escrito con la columna cruda, las reservas sin persona —todas las de
 * hoy— dejarían de chocar entre sí y la doble reserva se habilitaría en silencio.
 *
 * Negocio desechable propio: la base es compartida y nadie más la limpia.
 */

const BIZ = 'overlap-constraint-biz'
const OWNER = 'overlap-constraint-owner'
const SVC = 'overlap-constraint-svc'

let ana = ''
let juan = ''

// El horario es propio (año 2029) para no pisar los slots de las suites hermanas.
const START = new Date(Date.UTC(2029, 4, 10, 14, 0, 0))
const END = addMinutes(START, 60)

async function limpiar() {
  // Antes que nada las reservas: la FK de Booking a Professional es NO ACTION, así que
  // una reserva que todavía apunte a alguien hace fallar el borrado de la persona. Si
  // una corrida anterior murió a mitad, sin esto el beforeAll explota con un error de
  // FK que no dice nada del test que se está escribiendo.
  await prisma.booking.deleteMany({ where: { businessId: BIZ } })
  await prisma.customer.deleteMany({ where: { businessId: BIZ } })
  await prisma.professional.deleteMany({ where: { businessId: BIZ } })
  await prisma.service.deleteMany({ where: { businessId: BIZ } })
  await prisma.business.deleteMany({ where: { id: BIZ } })
  await prisma.user.deleteMany({ where: { id: OWNER } })
}

beforeAll(async () => {
  await limpiar()
  await prisma.user.create({ data: { id: OWNER, email: 'overlap-constraint@test.test', name: 'Dueña' } })
  await prisma.business.create({
    data: {
      id: BIZ,
      name: 'Barbería Constraint',
      slug: BIZ,
      subdomain: 'overlapconstraint',
      ownerUserId: OWNER,
      city: 'Santiago',
      timezone: 'America/Santiago',
    },
  })
  await prisma.service.create({
    data: { id: SVC, businessId: BIZ, name: 'Corte', durationMinutes: 60, price: 10000, depositAmount: 0, pastelColor: '#FFB3BA' },
  })
  ana = (await prisma.professional.create({ data: { businessId: BIZ, name: 'Ana' } })).id
  juan = (await prisma.professional.create({ data: { businessId: BIZ, name: 'Juan' } })).id
})

beforeEach(async () => {
  await prisma.booking.deleteMany({ where: { businessId: BIZ } })
  await prisma.customer.deleteMany({ where: { businessId: BIZ } })
})

afterAll(async () => {
  await limpiar()
  await prisma.$disconnect()
})

let telefono = 0

async function reservar(professionalId: string | null, status: BookingStatus = 'confirmed') {
  telefono += 1
  const customer = await prisma.customer.create({
    data: { businessId: BIZ, name: `Clienta ${telefono}`, phone: `+5691188000${telefono}` },
  })
  return prisma.booking.create({
    data: {
      businessId: BIZ,
      serviceId: SVC,
      customerId: customer.id,
      professionalId,
      startDateTime: START,
      endDateTime: END,
      status,
      paymentStatus: 'unpaid',
      totalPrice: 10000,
      depositRequired: 0,
      depositPaid: 0,
      remainingBalance: 10000,
      discountAmount: 0,
      finalAmount: 10000,
    },
  })
}

describe('Booking_no_overlap con la persona adentro', () => {
  // Es LA capacidad del track: sin esto, la segunda clienta ve "ese horario ya no está
  // disponible" sobre una hora que la pantalla le acaba de ofrecer como libre.
  it('dos personas distintas pueden tener cita a la misma hora', async () => {
    await reservar(ana)
    await expect(reservar(juan)).resolves.toMatchObject({ professionalId: juan })
  })

  it('la misma persona no puede tener dos citas encimadas', async () => {
    await reservar(ana)
    await expect(reservar(ana)).rejects.toThrow()
  })

  /**
   * La regresión que el `COALESCE` existe para impedir. Es el comportamiento de HOY de
   * todos los negocios —una sola agenda, sin equipo— y romperlo no da error en ningún
   * lado: simplemente entran dos clientas a la misma hora.
   */
  it('dos reservas SIN persona siguen chocando entre sí', async () => {
    await reservar(null)
    await expect(reservar(null)).rejects.toThrow()
  })

  /**
   * La asimetría de `bookingScopeCondition` escrita contra la base: una cita sin dueño
   * ocupa la hora para todos. Acá el constraint NO la reproduce —'' y el id de Ana son
   * valores distintos, así que no chocan— y por eso la capa lógica sigue haciendo
   * falta: es la que rechaza este caso antes de llegar al insert.
   */
  it('el constraint por sí solo no separa una cita sin dueño de una con dueño', async () => {
    await reservar(null)
    await expect(reservar(ana)).resolves.toMatchObject({ professionalId: ana })
  })
})

/**
 * Lo que agrega `booking_overlap_solicitudes`. Hasta esa migración una solicitud
 * esperando el visto bueno podía solapar cualquier cosa: el WHERE del EXCLUDE no la
 * miraba. El 23P01 no aparecía al crearla sino al APROBARLA —recién ahí el status pasa
 * a `confirmed`— o sea adentro de la action de aprobación y sobre una reserva que la
 * dueña acababa de aceptar.
 *
 * Que un test de unidad "ya cubra" esto es la trampa: la lista de estados vive en DOS
 * lugares (este WHERE y `occupiesSlot`) y sólo un test contra la base ve el primero.
 */
describe('Booking_no_overlap cubre las solicitudes', () => {
  it('una solicitud no puede encimarse sobre una cita confirmada', async () => {
    await reservar(ana, 'confirmed')
    await expect(reservar(ana, 'pending_confirmation')).rejects.toThrow()
  })

  it('una cita confirmada no puede encimarse sobre una solicitud', async () => {
    await reservar(ana, 'pending_confirmation')
    await expect(reservar(ana, 'confirmed')).rejects.toThrow()
  })

  it('dos solicitudes por el mismo horario tampoco conviven', async () => {
    await reservar(ana, 'pending_confirmation')
    await expect(reservar(ana, 'pending_confirmation')).rejects.toThrow()
  })

  // El otro lado de la moneda: una solicitud que el cron ya expiró NO retiene nada.
  // Si esto fallara, el horario quedaría muerto para siempre.
  it('una solicitud ya expirada deja pasar la cita nueva', async () => {
    await reservar(ana, 'expired')
    await expect(reservar(ana, 'confirmed')).resolves.toMatchObject({ status: 'confirmed' })
  })
})
