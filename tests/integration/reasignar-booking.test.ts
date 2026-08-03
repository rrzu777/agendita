import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { prisma } from '@/lib/db'
import { reassignBookingInTx } from '@/lib/bookings/mutate'
import { SLOT_UNAVAILABLE_MESSAGE } from '@/lib/availability/validation'

/**
 * Reasignar contra Postgres de verdad: el chequeo de disponibilidad de la
 * persona nueva (con su advisory lock y el `excludeBookingId`) y el guard por
 * estado corren contra la misma base que tiene el EXCLUDE por persona.
 *
 * Negocio desechable propio, no el del seed compartido (reglas de esta suite:
 * la DB es compartida y nadie la limpia).
 */

const BIZ = 'reasignar-biz'
const OWNER = 'reasignar-owner'
const TZ = 'America/Santiago'

// 2029-06-04 es lunes (dayOfWeek 1); junio en Santiago es UTC-4, así que
// 15:00Z = 11:00 local, adentro de la regla 09:00-18:00 del negocio.
const LUNES_11 = new Date('2029-06-04T15:00:00Z')
const LUNES_12 = new Date('2029-06-04T16:00:00Z')
const LUNES_14 = new Date('2029-06-04T18:00:00Z')
const LUNES_15 = new Date('2029-06-04T19:00:00Z')

let juan = ''
let ana = ''
let serviceId = ''
let customerId = ''

async function limpiar() {
  await prisma.booking.deleteMany({ where: { businessId: BIZ } })
  await prisma.availabilityRule.deleteMany({ where: { businessId: BIZ } })
  await prisma.professional.deleteMany({ where: { businessId: BIZ } })
  await prisma.customer.deleteMany({ where: { businessId: BIZ } })
  await prisma.service.deleteMany({ where: { businessId: BIZ } })
  await prisma.business.deleteMany({ where: { id: BIZ } })
  await prisma.user.deleteMany({ where: { id: OWNER } })
}

beforeAll(async () => {
  await limpiar()
  await prisma.user.create({ data: { id: OWNER, email: 'reasignar@test.test', name: 'Dueña' } })
  await prisma.business.create({
    data: {
      id: BIZ,
      name: 'Barbería Reasignar',
      slug: 'reasignar-biz',
      subdomain: 'reasignar',
      ownerUserId: OWNER,
      city: 'Santiago',
      timezone: TZ,
    },
  })
  serviceId = (await prisma.service.create({
    data: { businessId: BIZ, name: 'Corte', durationMinutes: 60, price: 20000, depositAmount: 0, pastelColor: '#FFD700' },
  })).id
  customerId = (await prisma.customer.create({
    data: { businessId: BIZ, name: 'Clienta', phone: '+56933334444' },
  })).id
  juan = (await prisma.professional.create({ data: { businessId: BIZ, name: 'Juan' } })).id
  ana = (await prisma.professional.create({ data: { businessId: BIZ, name: 'Ana' } })).id
  // Horario del negocio (nadie tiene horario propio: los dos lo heredan).
  await prisma.availabilityRule.create({
    data: { businessId: BIZ, dayOfWeek: 1, startTime: '09:00', endTime: '18:00', isActive: true },
  })
})

afterAll(async () => {
  await limpiar()
  await prisma.$disconnect()
})

function crearReserva(input: {
  professionalId: string | null
  startDateTime: Date
  endDateTime: Date
  status?: 'confirmed' | 'completed'
  internalNotes?: string
}) {
  return prisma.booking.create({
    data: {
      businessId: BIZ,
      serviceId,
      customerId,
      professionalId: input.professionalId,
      startDateTime: input.startDateTime,
      endDateTime: input.endDateTime,
      status: input.status ?? 'confirmed',
      paymentStatus: 'unpaid',
      totalPrice: 20000,
      depositRequired: 0,
      depositPaid: 0,
      remainingBalance: 20000,
      discountAmount: 0,
      finalAmount: 20000,
      internalNotes: input.internalNotes ?? null,
    },
  })
}

function reasignar(booking: Awaited<ReturnType<typeof crearReserva>>, args: {
  newProfessionalId: string
  newProfessionalName: string
  previousProfessionalName: string | null
}) {
  return prisma.$transaction(async (tx) => {
    await reassignBookingInTx(tx, { booking, timezone: TZ, ...args })
  })
}

describe('reassignBookingInTx contra la base', () => {
  it('le pasa la cita a alguien libre sin mover la hora, y lo anota', async () => {
    const cita = await crearReserva({ professionalId: juan, startDateTime: LUNES_11, endDateTime: LUNES_12, internalNotes: 'Llegó por WhatsApp' })

    await reasignar(cita, { newProfessionalId: ana, newProfessionalName: 'Ana', previousProfessionalName: 'Juan' })

    const despues = await prisma.booking.findUniqueOrThrow({ where: { id: cita.id } })
    expect(despues.professionalId).toBe(ana)
    expect(despues.startDateTime.getTime()).toBe(LUNES_11.getTime())
    expect(despues.internalNotes).toBe('Llegó por WhatsApp\n[REASIGNADA: de Juan a Ana]')

    await prisma.booking.delete({ where: { id: cita.id } })
  })

  it('rechaza pasarla a alguien que ya tiene una cita encima de esa hora', async () => {
    const deJuan = await crearReserva({ professionalId: juan, startDateTime: LUNES_11, endDateTime: LUNES_12 })
    const deAna = await crearReserva({ professionalId: ana, startDateTime: LUNES_11, endDateTime: LUNES_12 })

    await expect(
      reasignar(deJuan, { newProfessionalId: ana, newProfessionalName: 'Ana', previousProfessionalName: 'Juan' }),
    ).rejects.toThrow(SLOT_UNAVAILABLE_MESSAGE)

    // La cita no se movió de manos.
    const intacta = await prisma.booking.findUniqueOrThrow({ where: { id: deJuan.id } })
    expect(intacta.professionalId).toBe(juan)

    await prisma.booking.deleteMany({ where: { id: { in: [deJuan.id, deAna.id] } } })
  })

  it('asignar una cita sin persona funciona igual, con su propia nota', async () => {
    const sinPersona = await crearReserva({ professionalId: null, startDateTime: LUNES_14, endDateTime: LUNES_15 })

    await reasignar(sinPersona, { newProfessionalId: juan, newProfessionalName: 'Juan', previousProfessionalName: null })

    const despues = await prisma.booking.findUniqueOrThrow({ where: { id: sinPersona.id } })
    expect(despues.professionalId).toBe(juan)
    expect(despues.internalNotes).toBe('[ASIGNADA a Juan]')

    await prisma.booking.delete({ where: { id: sinPersona.id } })
  })

  it('una cita en estado terminal no se reasigna', async () => {
    const completada = await crearReserva({ professionalId: juan, startDateTime: LUNES_14, endDateTime: LUNES_15, status: 'completed' })

    await expect(
      reasignar(completada, { newProfessionalId: ana, newProfessionalName: 'Ana', previousProfessionalName: 'Juan' }),
    ).rejects.toThrow('No se puede reasignar una reserva en este estado')

    await prisma.booking.delete({ where: { id: completada.id } })
  })

  it('el horario propio de la persona nueva manda: fuera de su regla, rechaza', async () => {
    // Ana pasa a tener horario propio de lunes SOLO por la mañana: materializar
    // una regla suya corta la herencia del horario del negocio.
    await prisma.availabilityRule.create({
      data: { businessId: BIZ, professionalId: ana, dayOfWeek: 1, startTime: '09:00', endTime: '12:00', isActive: true },
    })
    const cita = await crearReserva({ professionalId: juan, startDateTime: LUNES_14, endDateTime: LUNES_15 })

    await expect(
      reasignar(cita, { newProfessionalId: ana, newProfessionalName: 'Ana', previousProfessionalName: 'Juan' }),
    ).rejects.toThrow(SLOT_UNAVAILABLE_MESSAGE)

    await prisma.booking.delete({ where: { id: cita.id } })
    await prisma.availabilityRule.deleteMany({ where: { businessId: BIZ, professionalId: ana } })
  })
})
