import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { addMinutes } from 'date-fns'
import { prisma } from '@/lib/db'
import { assertSlotAndResolveProfessional, NO_ONE_AVAILABLE_MESSAGE } from '@/lib/professionals/assign'
import type { ProfessionalPick } from '@/lib/professionals/eligible'
import { requireTestDatabase } from './setup'

requireTestDatabase()

/**
 * "Cualquiera disponible" de punta a punta, que es lo único que puede probar la base:
 *
 * 1. **que la unión que se OFRECE y los horarios de cada persona sean la misma
 *    cuenta.** Son dos caminos distintos —uno reparte en memoria una lectura por
 *    concepto, el otro filtra por persona en SQL— y si divergen, elegir a Juan después
 *    de ver "las 10 con cualquiera" hace desaparecer las 10 sin explicación;
 * 2. **que a quién le toca se resuelva de verdad contra la agenda**, saltando a quien
 *    está ocupado y repartiendo por carga;
 * 3. **que dos "cualquiera" a la misma hora entren las dos.** Ahí está el EXCLUDE
 *    `Booking_no_overlap`, que no existe en `schema.prisma` y no lo puede ver ningún
 *    test de unidad.
 *
 * Negocio desechable propio: la base es compartida y nadie más la limpia.
 */

const BIZ = 'cualquiera-biz'
const OWNER = 'cualquiera-owner'
const SVC = 'cualquiera-svc'

let juan = ''
let ana = ''

// Fecha fija y lejana para no pisar los slots de las suites hermanas. La ventana de
// reserva del negocio se abre a 10 años para que el chequeo no la rebote: lo que se
// prueba acá es con quién, no hasta cuándo se puede reservar.
const INICIO = new Date(Date.UTC(2029, 6, 10, 14, 0, 0)) // 10:00 en Santiago (UTC-4 en julio)
const TZ = 'America/Santiago'

async function limpiar() {
  // Las reservas primero: la FK de Booking a Professional es NO ACTION y una reserva
  // viva hace fallar el borrado de la persona con un error que no habla del test.
  await prisma.booking.deleteMany({ where: { businessId: BIZ } })
  await prisma.customer.deleteMany({ where: { businessId: BIZ } })
  await prisma.availabilityRule.deleteMany({ where: { businessId: BIZ } })
  await prisma.professional.deleteMany({ where: { businessId: BIZ } })
  await prisma.service.deleteMany({ where: { businessId: BIZ } })
  await prisma.business.deleteMany({ where: { id: BIZ } })
  await prisma.user.deleteMany({ where: { id: OWNER } })
}

beforeAll(async () => {
  await limpiar()
  await prisma.user.create({ data: { id: OWNER, email: 'cualquiera@test.test', name: 'Dueña' } })
  await prisma.business.create({
    data: {
      id: BIZ, name: 'Barbería Cualquiera', slug: BIZ, subdomain: 'cualquierabiz',
      ownerUserId: OWNER, city: 'Santiago', timezone: TZ, category: 'barber',
      bookingWindowDays: 3650,
    },
  })
  await prisma.service.create({
    data: { id: SVC, businessId: BIZ, name: 'Corte', durationMinutes: 60, price: 10000, depositAmount: 0, pastelColor: '#FFB3BA' },
  })
  // Los siete días, para que el test no dependa de en qué día cae la fecha fija.
  await prisma.availabilityRule.createMany({
    data: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
      businessId: BIZ, dayOfWeek, startTime: '09:00', endTime: '18:00', isActive: true,
    })),
  })
  juan = (await prisma.professional.create({
    data: { businessId: BIZ, name: 'Juan', sortOrder: 0, services: { connect: [{ id: SVC }] } },
  })).id
  ana = (await prisma.professional.create({
    data: { businessId: BIZ, name: 'Ana', sortOrder: 1, services: { connect: [{ id: SVC }] } },
  })).id
})

beforeEach(async () => {
  await prisma.booking.deleteMany({ where: { businessId: BIZ } })
  await prisma.customer.deleteMany({ where: { businessId: BIZ } })
})

afterAll(async () => {
  await limpiar()
  await prisma.$disconnect()
})

let cliente = 0

async function nuevaClienta() {
  cliente += 1
  return prisma.customer.create({
    data: { businessId: BIZ, name: `Clienta ${cliente}`, phone: `+5691177000${cliente}` },
  })
}

/** Una cita ya agendada, escrita directo: acá interesa que ocupe, no cómo se creó. */
async function citaDe(professionalId: string, start: Date = INICIO) {
  const customer = await nuevaClienta()
  return prisma.booking.create({
    data: {
      businessId: BIZ, serviceId: SVC, customerId: customer.id, professionalId,
      startDateTime: start, endDateTime: addMinutes(start, 60),
      status: 'confirmed', paymentStatus: 'unpaid',
      totalPrice: 10000, depositRequired: 0, depositPaid: 0,
      remainingBalance: 10000, discountAmount: 0, finalAmount: 10000,
    },
  })
}

async function horarios(professional: ProfessionalPick): Promise<string[]> {
  const { getAvailableTimeSlots } = await import('@/server/actions/availability')
  const res = await getAvailableTimeSlots({ businessId: BIZ, serviceId: SVC, date: INICIO, professional })
  if (!res.ok) throw new Error(`esperaba horarios, salió: ${res.error}`)
  return res.data.map((s) => s.start.toISOString())
}

/** El camino real de la escritura: resolver adentro de la transacción y recién ahí
 *  insertar, que es lo que le da sentido al advisory lock. */
async function reservarCualquiera(start: Date = INICIO) {
  const customer = await nuevaClienta()
  return prisma.$transaction(async (tx) => {
    const professionalId = await assertSlotAndResolveProfessional({
      tx, businessId: BIZ, serviceId: SVC,
      startDateTime: start, endDateTime: addMinutes(start, 60),
      timezone: TZ, professional: { kind: 'anyone' }, modality: 'on_site',
    })
    return tx.booking.create({
      data: {
        businessId: BIZ, serviceId: SVC, customerId: customer.id, professionalId,
        startDateTime: start, endDateTime: addMinutes(start, 60),
        status: 'confirmed', paymentStatus: 'unpaid',
        totalPrice: 10000, depositRequired: 0, depositPaid: 0,
        remainingBalance: 10000, discountAmount: 0, finalAmount: 10000,
      },
    })
  })
}

describe('los horarios que ve quien no elige a nadie', () => {
  /**
   * El invariante que ata los dos caminos. Se compara contra la unión CALCULADA a
   * partir de los horarios por persona, no contra una lista escrita a mano: así el
   * test no se cae cuando cambia la grilla, sólo cuando los dos caminos dejan de
   * decir lo mismo.
   */
  it('son exactamente la unión de los del equipo, sin repetir', async () => {
    await citaDe(juan)

    const deJuan = await horarios({ kind: 'person', id: juan })
    const deAna = await horarios({ kind: 'person', id: ana })
    const cualquiera = await horarios({ kind: 'anyone' })

    expect(cualquiera).toEqual([...new Set([...deJuan, ...deAna])].sort())
    // Y no es una lista pegada: la hora que Juan tiene ocupada aparece UNA vez,
    // porque Ana la tiene libre.
    expect(cualquiera).toHaveLength(deAna.length)
    expect(deJuan).not.toContain(INICIO.toISOString())
    expect(cualquiera).toContain(INICIO.toISOString())
  })

  it('la hora se cae cuando la tienen ocupada los dos', async () => {
    await citaDe(juan)
    await citaDe(ana)

    expect(await horarios({ kind: 'anyone' })).not.toContain(INICIO.toISOString())
  })
})

describe('a quién le toca al reservar', () => {
  it('a quien tenga la hora libre, aunque no sea el primero de la lista', async () => {
    await citaDe(juan)

    const reserva = await reservarCualquiera()
    expect(reserva.professionalId).toBe(ana)
  })

  // Sin nada agendado manda el orden que definió la dueña.
  it('con el día vacío, el orden del panel', async () => {
    const reserva = await reservarCualquiera()
    expect(reserva.professionalId).toBe(juan)
  })

  /**
   * El reparto por carga. Juan tiene dos citas ese día en OTRAS horas: está libre a
   * las 10, pero no es a quien le toca. Sin esto, el primero de la lista se lleva el
   * día entero.
   */
  it('a quien menos citas tiene ese día', async () => {
    await citaDe(juan, new Date(Date.UTC(2029, 6, 10, 16, 0, 0)))
    await citaDe(juan, new Date(Date.UTC(2029, 6, 10, 18, 0, 0)))

    const reserva = await reservarCualquiera()
    expect(reserva.professionalId).toBe(ana)
  })

  /**
   * La capacidad entera del track, contra el constraint de verdad: dos clientas piden
   * la misma hora sin elegir a nadie y entran las dos, cada una con una persona. La
   * tercera no tiene con quién y se va con el mensaje de horario ocupado.
   */
  it('dos clientas entran a la misma hora, la tercera no', async () => {
    const primera = await reservarCualquiera()
    const segunda = await reservarCualquiera()

    expect([primera.professionalId, segunda.professionalId].sort()).toEqual([juan, ana].sort())
    await expect(reservarCualquiera()).rejects.toThrow('Ese horario ya no está disponible')
  })

  /**
   * La dueña le sacó el servicio a todo el mundo. No es "esa hora está tomada" —
   * ninguna hora va a funcionar— y por eso el mensaje es otro.
   */
  it('sin nadie que haga el servicio lo dice distinto', async () => {
    await prisma.professional.update({ where: { id: juan }, data: { services: { set: [] } } })
    await prisma.professional.update({ where: { id: ana }, data: { services: { set: [] } } })

    await expect(reservarCualquiera()).rejects.toThrow(NO_ONE_AVAILABLE_MESSAGE)
    // Y la pantalla, coherente, no ofrece ninguna hora.
    expect(await horarios({ kind: 'anyone' })).toEqual([])

    await prisma.professional.update({ where: { id: juan }, data: { services: { connect: [{ id: SVC }] } } })
    await prisma.professional.update({ where: { id: ana }, data: { services: { connect: [{ id: SVC }] } } })
  })
})
