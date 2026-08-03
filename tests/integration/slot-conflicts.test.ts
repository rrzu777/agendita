import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { addMinutes } from 'date-fns'
import { prisma } from '@/lib/db'
import { assertSlotFreeOfConflicts } from '@/lib/availability/validation'
import { requireTestDatabase } from './setup'
import {
  seedDeclaredTransfer, seedConfirmedBooking, cleanupBankTransferSeed, BT_VERIFY_BIZ, BT_VERIFY_SVC,
} from './helpers/bank-transfer-seed'

requireTestDatabase()

const TZ = 'America/Santiago'

// OJO: seedConfirmedBooking NO siembra el negocio (asume que existe); solo
// seedDeclaredTransfer corre ensureBusiness. Sin este beforeAll, correr el
// archivo solo revienta con FK violation.
beforeAll(async () => {
  await seedDeclaredTransfer()
})

afterAll(async () => {
  // cleanupBankTransferSeed no borra TimeBlocks: limpiarlos acá para que una
  // aserción fallida no deje bloques huérfanos que pisen otros archivos.
  await prisma.timeBlock.deleteMany({ where: { businessId: BT_VERIFY_BIZ } })
  await cleanupBankTransferSeed()
  await prisma.$disconnect()
})

// Slots propios (año 2028) para no chocar con los de otros tests de la suite.
function slot(day: number, hourUtc: number) {
  const start = new Date(Date.UTC(2028, 2, day, hourUtc, 0, 0))
  return { startDateTime: start, endDateTime: addMinutes(start, 60) }
}

describe('assertSlotFreeOfConflicts', () => {
  it('resuelve cuando el slot está libre (sin exigir servicio activo ni reglas)', async () => {
    const s = slot(1, 15)
    await expect(
      assertSlotFreeOfConflicts({ tx: prisma, businessId: BT_VERIFY_BIZ, timezone: TZ, professionalId: null, ...s }),
    ).resolves.toBeUndefined()
  })

  it('tira si un TimeBlock solapa el slot', async () => {
    const s = slot(2, 15)
    const block = await prisma.timeBlock.create({
      data: {
        businessId: BT_VERIFY_BIZ,
        startDateTime: s.startDateTime,
        endDateTime: s.endDateTime,
        reason: 'test block',
      },
    })
    await expect(
      assertSlotFreeOfConflicts({ tx: prisma, businessId: BT_VERIFY_BIZ, timezone: TZ, professionalId: null, ...s }),
    ).rejects.toThrow('Ese horario ya no está disponible')
    await prisma.timeBlock.delete({ where: { id: block.id } })
  })

  // El SQL crudo ya no repite la regla, pero sigue siendo crudo: los estados van
  // como literales y las filas vuelven de `$queryRaw` para que las lea
  // `occupiesSlot` en memoria. Estos dos casos son la red de esa costura — si el
  // status llegara con otro nombre, o `holdExpiresAt` como string en vez de Date,
  // el predicado dejaría de distinguir hold vivo de hold vencido y acá se cae.
  it('una solicitud por confirmar con hold vivo ocupa el cupo', async () => {
    const s = slot(4, 15)
    await seedConfirmedBooking({
      businessId: BT_VERIFY_BIZ, serviceId: BT_VERIFY_SVC, ...s,
      status: 'pending_confirmation', holdExpiresAt: addMinutes(new Date(), 60),
    })
    await expect(
      assertSlotFreeOfConflicts({ tx: prisma, businessId: BT_VERIFY_BIZ, timezone: TZ, professionalId: null, ...s }),
    ).rejects.toThrow('Ese horario ya no está disponible')
  })

  // El hold vencido NO libera: desde `booking_overlap_solicitudes` el EXCLUDE cubre
  // `pending_confirmation`, así que darla por libre acá haría que la app ofrezca un
  // horario que el insert rechaza con 23P01. Se libera cuando el cron la expira, que
  // es además el único que le avisa a la clienta que nadie le respondió.
  it('una solicitud con el hold vencido sigue ocupando el cupo hasta que corre el cron', async () => {
    const s = slot(5, 15)
    await seedConfirmedBooking({
      businessId: BT_VERIFY_BIZ, serviceId: BT_VERIFY_SVC, ...s,
      status: 'pending_confirmation', holdExpiresAt: addMinutes(new Date(), -60),
    })
    await expect(
      assertSlotFreeOfConflicts({ tx: prisma, businessId: BT_VERIFY_BIZ, timezone: TZ, professionalId: null, ...s }),
    ).rejects.toThrow('Ese horario ya no está disponible')
  })

  it('una solicitud ya expirada por el cron sí libera el cupo', async () => {
    const s = slot(6, 15)
    await seedConfirmedBooking({
      businessId: BT_VERIFY_BIZ, serviceId: BT_VERIFY_SVC, ...s,
      status: 'expired', holdExpiresAt: addMinutes(new Date(), -60),
    })
    await expect(
      assertSlotFreeOfConflicts({ tx: prisma, businessId: BT_VERIFY_BIZ, timezone: TZ, professionalId: null, ...s }),
    ).resolves.toBeUndefined()
  })

  it('tira si una reserva activa solapa; excludeBookingId la exime', async () => {
    const s = slot(3, 15)
    const seeded = await seedConfirmedBooking({ businessId: BT_VERIFY_BIZ, serviceId: BT_VERIFY_SVC, ...s })
    await expect(
      assertSlotFreeOfConflicts({ tx: prisma, businessId: BT_VERIFY_BIZ, timezone: TZ, professionalId: null, ...s }),
    ).rejects.toThrow('Ese horario ya no está disponible')
    await expect(
      assertSlotFreeOfConflicts({
        tx: prisma, businessId: BT_VERIFY_BIZ, timezone: TZ, professionalId: null, ...s, excludeBookingId: seeded.bookingId,
      }),
    ).resolves.toBeUndefined()
  })
})
