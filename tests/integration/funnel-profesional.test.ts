import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { prisma } from '@/lib/db'
import { bookingBusinessInclude } from '@/lib/business/public'
import { assertProfessionalOffersService, PROFESSIONAL_UNAVAILABLE_MESSAGE } from '@/lib/professionals/ownership'
import { professionalChoice } from '@/lib/professionals/eligible'
import { requireTestDatabase } from './setup'

requireTestDatabase()

/**
 * Lo que sólo la base puede probar del funnel por persona:
 *
 * 1. que el `include` público traiga la relación servicio↔persona con la forma que
 *    el wizard espera. Es un `select` anidado adentro de un `include`, sobre la
 *    consulta que sirve TODA la pantalla de reservar — el archivo ya tiene dos
 *    avisos de queries que rompían en runtime sin que tsc dijera nada;
 * 2. que el guard del funnel público filtre de verdad por servicio y por modalidad.
 *    Un test de unidad prueba la FORMA del `where`; que Postgres lo resuelva como
 *    esperamos —sobre todo `modalities: { has: ... }`, que es una lista escalar de
 *    enums— sólo se ve contra filas reales.
 *
 * Negocio desechable propio y no el del seed compartido: esta suite crea gente y
 * servicios, y la base es compartida con las demás.
 */

const BIZ = 'funnel-persona-biz'
const OWNER = 'funnel-persona-owner'

let corte = ''
let masaje = ''
let juan = ''
let ana = ''

async function limpiar() {
  await prisma.booking.deleteMany({ where: { businessId: BIZ } })
  await prisma.professional.deleteMany({ where: { businessId: BIZ } })
  await prisma.service.deleteMany({ where: { businessId: BIZ } })
  await prisma.business.deleteMany({ where: { id: BIZ } })
  await prisma.user.deleteMany({ where: { id: OWNER } })
}

beforeAll(async () => {
  await limpiar()
  await prisma.user.create({ data: { id: OWNER, email: 'funnel-persona@test.test', name: 'Dueña' } })
  await prisma.business.create({
    data: {
      id: BIZ, name: 'Barbería Funnel', slug: 'funnel-persona-biz', subdomain: 'funnelpersona',
      ownerUserId: OWNER, city: 'Santiago', timezone: 'America/Santiago', category: 'barber',
    },
  })
  corte = (await prisma.service.create({
    data: { businessId: BIZ, name: 'Corte', durationMinutes: 30, price: 12000, depositAmount: 0, pastelColor: '#FFD700', sortOrder: 0 },
  })).id
  // Se pide en el local o a domicilio; quién viaja lo dice cada persona.
  masaje = (await prisma.service.create({
    data: {
      businessId: BIZ, name: 'Masaje', durationMinutes: 60, price: 30000, depositAmount: 0,
      pastelColor: '#BAFFC9', sortOrder: 1, modalities: ['on_site', 'at_home'],
    },
  })).id

  juan = (await prisma.professional.create({
    data: {
      businessId: BIZ, name: 'Juan', bio: 'Fade y barba', sortOrder: 0,
      modalities: ['on_site'], services: { connect: [{ id: corte }, { id: masaje }] },
    },
  })).id
  ana = (await prisma.professional.create({
    data: {
      businessId: BIZ, name: 'Ana', sortOrder: 1,
      modalities: ['on_site', 'at_home'], services: { connect: [{ id: masaje }] },
    },
  })).id
})

afterAll(async () => {
  await limpiar()
  await prisma.$disconnect()
})

describe('el equipo que viaja en el payload público', () => {
  it('llega con los ids de sus servicios y en el orden de la dueña', async () => {
    const business = await prisma.business.findUnique({ where: { slug: 'funnel-persona-biz' }, include: bookingBusinessInclude })

    expect(business!.professionals.map((p) => p.name)).toEqual(['Juan', 'Ana'])
    expect(business!.professionals[0].services.map((s) => s.id).sort()).toEqual([corte, masaje].sort())
    expect(business!.professionals[1].modalities).toEqual(['on_site', 'at_home'])
  })

  it('no publica a quien está en pausa', async () => {
    await prisma.professional.update({ where: { id: ana }, data: { isActive: false } })
    const business = await prisma.business.findUnique({ where: { slug: 'funnel-persona-biz' }, include: bookingBusinessInclude })
    expect(business!.professionals.map((p) => p.name)).toEqual(['Juan'])
    await prisma.professional.update({ where: { id: ana }, data: { isActive: true } })
  })

  // El puente entre la consulta y la pantalla: si el aplanado del payload cambia
  // de forma, la lista queda vacía y el paso no aparece nunca.
  it('el payload alimenta la decisión del funnel sin traducción de por medio', async () => {
    const business = await prisma.business.findUnique({ where: { slug: 'funnel-persona-biz' }, include: bookingBusinessInclude })
    const equipo = business!.professionals.map((p) => ({
      id: p.id, name: p.name, bio: p.bio, modalities: p.modalities, serviceIds: p.services.map((s) => s.id),
    }))

    // El corte lo hace sólo Juan: no hay nada que preguntar.
    expect(professionalChoice(equipo, corte, 'on_site')).toMatchObject({ kind: 'auto' })
    // El masaje en el local lo hacen los dos.
    expect(professionalChoice(equipo, masaje, 'on_site').kind).toBe('ask')
    // A domicilio sólo va Ana.
    const domicilio = professionalChoice(equipo, masaje, 'at_home')
    expect(domicilio.kind === 'auto' && domicilio.professional.name).toBe('Ana')
  })
})

describe('el guard de la escritura', () => {
  it('acepta a quien hace ese servicio en esa modalidad', async () => {
    await expect(assertProfessionalOffersService(prisma, BIZ, ana, masaje, 'at_home')).resolves.toBe(ana)
  })

  it('rechaza a quien no hace ese servicio', async () => {
    await expect(assertProfessionalOffersService(prisma, BIZ, ana, corte, 'on_site'))
      .rejects.toThrow(PROFESSIONAL_UNAVAILABLE_MESSAGE)
  })

  // La que se olvida: el servicio se puede pedir a domicilio y Juan no viaja.
  it('rechaza a quien no atiende en esa modalidad', async () => {
    await expect(assertProfessionalOffersService(prisma, BIZ, juan, masaje, 'at_home'))
      .rejects.toThrow(PROFESSIONAL_UNAVAILABLE_MESSAGE)
    await expect(assertProfessionalOffersService(prisma, BIZ, juan, masaje, 'on_site')).resolves.toBe(juan)
  })

  it('rechaza a quien está en pausa', async () => {
    await prisma.professional.update({ where: { id: juan }, data: { isActive: false } })
    await expect(assertProfessionalOffersService(prisma, BIZ, juan, corte, 'on_site'))
      .rejects.toThrow(PROFESSIONAL_UNAVAILABLE_MESSAGE)
    await prisma.professional.update({ where: { id: juan }, data: { isActive: true } })
  })

  it('rechaza a alguien de otro negocio', async () => {
    await expect(assertProfessionalOffersService(prisma, 'otro-negocio', juan, corte, 'on_site'))
      .rejects.toThrow(PROFESSIONAL_UNAVAILABLE_MESSAGE)
  })
})

/**
 * El test que ata las dos caras de la regla.
 *
 * `professionalChoice` filtra en el navegador sobre una lista ya traída;
 * `assertProfessionalOffersService` filtra en Postgres para autorizar la escritura.
 * Son dos implementaciones del mismo predicado y las dos fallas son mudas: si el
 * navegador queda más permisivo, la clienta elige a alguien y se entera del rechazo
 * en el paso de PAGO; si queda más restrictivo, la persona desaparece de la lista y
 * nadie se entera nunca.
 *
 * Recorre la matriz entera —cada persona × cada servicio × cada modalidad— en vez de
 * casos elegidos a mano: la próxima condición de elegibilidad que se agregue de un
 * solo lado cae acá sin que haya que acordarse de escribir el caso.
 */
describe('las dos caras de la elegibilidad dicen lo mismo', () => {
  it('para toda combinación de persona, servicio y modalidad', async () => {
    const business = await prisma.business.findUnique({ where: { id: BIZ }, include: bookingBusinessInclude })
    const equipo = business!.professionals.map((p) => ({
      id: p.id, name: p.name, bio: p.bio, modalities: p.modalities, serviceIds: p.services.map((s) => s.id),
    }))

    for (const persona of equipo) {
      for (const serviceId of [corte, masaje]) {
        for (const modality of ['on_site', 'at_home'] as const) {
          // Lo que diría la pantalla: ¿esta persona aparece entre las opciones?
          const choice = professionalChoice([persona], serviceId, modality)
          const enLaLista = choice.kind !== 'none'

          // Lo que diría la escritura.
          const autorizada = await assertProfessionalOffersService(prisma, BIZ, persona.id, serviceId, modality)
            .then(() => true)
            .catch(() => false)

          expect(autorizada, `${persona.name} · ${serviceId === corte ? 'corte' : 'masaje'} · ${modality}`).toBe(enLaLista)
        }
      }
    }
  })
})
