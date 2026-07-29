import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { prisma } from '@/lib/db'
import { requireTestDatabase } from './setup'
import { seedDeclaredTransfer, cleanupBankTransferSeed, BT_VERIFY_BIZ } from './helpers/bank-transfer-seed'

requireTestDatabase()

// La columna `Service.modalities` es una lista escalar de enums en Postgres
// (`"ServiceModality"[]`), la primera del proyecto. Estos casos existen para que
// la migración se pruebe de verdad: el default del backfill, el round-trip de un
// array con varios valores y el filtrado por contenido.

const SVC = 'modality-svc-1'

beforeAll(async () => {
  await seedDeclaredTransfer() // siembra el negocio
})

afterAll(async () => {
  await prisma.service.deleteMany({ where: { id: SVC } })
  await cleanupBankTransferSeed()
  await prisma.$disconnect()
})

describe('Service.modalities', () => {
  it('un servicio creado sin modalidades queda en el local (default de la columna)', async () => {
    const created = await prisma.service.create({
      data: {
        id: SVC, businessId: BT_VERIFY_BIZ, name: 'Masaje', durationMinutes: 60,
        price: 30000, depositAmount: 0, pastelColor: '#f4dbca',
      },
    })
    expect(created.modalities).toEqual(['on_site'])
  })

  it('guarda y devuelve varias modalidades conservando el orden escrito', async () => {
    const updated = await prisma.service.update({
      where: { id: SVC },
      data: { modalities: ['on_site', 'at_home'] },
    })
    expect(updated.modalities).toEqual(['on_site', 'at_home'])

    const read = await prisma.service.findUnique({ where: { id: SVC } })
    expect(read!.modalities).toEqual(['on_site', 'at_home'])
  })

  it('se puede filtrar por una modalidad contenida en la lista', async () => {
    const atHome = await prisma.service.findMany({
      where: { businessId: BT_VERIFY_BIZ, modalities: { has: 'at_home' } },
      select: { id: true },
    })
    expect(atHome.map((s) => s.id)).toContain(SVC)

    const online = await prisma.service.findMany({
      where: { businessId: BT_VERIFY_BIZ, modalities: { has: 'online' } },
      select: { id: true },
    })
    expect(online.map((s) => s.id)).not.toContain(SVC)
  })
})

describe('Booking.modality', () => {
  it('las reservas ya existentes quedaron en el local (backfill por DEFAULT)', async () => {
    // El seed crea su reserva sin pasar `modality`: es el mismo camino que
    // siguieron las filas viejas al aplicarse la migración.
    const booking = await prisma.booking.findFirst({
      where: { businessId: BT_VERIFY_BIZ },
      select: { modality: true, serviceAddress: true, meetingUrl: true },
    })
    expect(booking!.modality).toBe('on_site')
    expect(booking!.serviceAddress).toBeNull()
    expect(booking!.meetingUrl).toBeNull()
  })
})
