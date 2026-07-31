import { PrismaClient } from '@prisma/client'
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { requireTestDatabase } from './setup'
import { unwrap, expectActionError } from './helpers/action-result'

requireTestDatabase()

// El reintento de pago: la clienta apretó "Intentar de nuevo" o volvió del
// checkout y re-envió, y el wizard manda la MISMA idempotencyKey. El fast path
// devolvía la reserva guardada sin mirar nada, así que el reintento salía a
// pagar un horario que en el medio pudo perderse, y con un hold que pudo vencer
// (initiatePayment lo rechaza → el botón repite el mismo error para siempre).
//
// Va como integración y no como unit porque lo que puede volver a romperse es la
// interacción con la base: quién ocupa el horario lo decide un SQL crudo con
// advisory lock, y el hold renovado tiene que quedar escrito de verdad.
const BIZ = 'retry-biz-1'
const OWNER_USER = 'retry-owner-1'

vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: async () => ({ success: true, remaining: 30, resetAt: 0 }) }))
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
vi.mock('@/server/actions/revalidate-business', () => ({ revalidateBusinessPublicPaths: async () => {} }))
vi.mock('@/lib/notifications', () => ({
  getBusinessReplyToEmail: async () => 'owner@retry.test',
  sendBookingReceivedToCustomer: async () => ({ success: true }),
  sendNewBookingNotificationToBusiness: async () => [],
  sendBookingCancelledNotification: async () => ({ success: true }),
  sendBookingConfirmedNotification: async () => ({ success: true }),
  sendBookingRescheduledNotification: async () => ({ success: true }),
  sendNotificationSafely: async () => ({ success: true }),
  sendMultiNotificationSafely: async () => [],
}))
vi.mock('@/lib/auth/user', () => ({
  getCurrentUser: async () => null,
  getConfirmedSessionUser: async () => null,
}))

describe('reintento de pago con la misma idempotencyKey', () => {
  let prisma: PrismaClient
  let serviceId: string

  beforeAll(async () => {
    prisma = new PrismaClient()
    await limpiar()

    await prisma.user.create({ data: { id: OWNER_USER, email: 'owner@retry.test', name: 'Retry Owner' } })
    await prisma.business.create({ data: {
      id: BIZ, name: 'Retry Biz', slug: 'retry-biz', subdomain: 'retrybiz', ownerUserId: OWNER_USER,
      city: 'Santiago', country: 'CL', currency: 'CLP', timezone: 'America/Santiago', bookingWindowDays: 90,
    } })
    const service = await prisma.service.create({ data: {
      id: 'retry-svc-1', businessId: BIZ, name: 'Corte', durationMinutes: 60,
      price: 20000, depositAmount: 5000, pastelColor: '#FFD700',
    } })
    serviceId = service.id

    for (let day = 0; day <= 6; day++) {
      await prisma.availabilityRule.create({
        data: { businessId: BIZ, dayOfWeek: day, startTime: '00:00', endTime: '23:59', isActive: true },
      })
    }
  })

  /** Lo que cambia entre casos. El resto del seed (negocio, servicio, reglas) vive
   *  todo el archivo. */
  async function limpiarReservas() {
    await prisma.payment.deleteMany({ where: { businessId: BIZ } })
    await prisma.booking.deleteMany({ where: { businessId: BIZ } })
    await prisma.timeBlock.deleteMany({ where: { businessId: BIZ } })
  }

  async function limpiar() {
    await limpiarReservas()
    await prisma.customer.deleteMany({ where: { businessId: BIZ } })
    await prisma.service.deleteMany({ where: { businessId: BIZ } })
    await prisma.availabilityRule.deleteMany({ where: { businessId: BIZ } })
    await prisma.business.deleteMany({ where: { id: BIZ } })
    await prisma.user.deleteMany({ where: { id: OWNER_USER } })
  }

  afterAll(async () => {
    await limpiar()
    await prisma.$disconnect()
  })

  // Cada caso arranca sin reservas ni bloqueos: una reserva ajena en el mismo
  // horario haría pasar (o fallar) al siguiente por el motivo equivocado.
  beforeEach(limpiarReservas)

  /** Un horario futuro, lejos del lead time y dentro de la ventana de reserva.
   *  Compartido: la tabla se vacía entre casos, nadie se pisa el hueco. */
  const START = (() => {
    const d = new Date()
    d.setUTCDate(d.getUTCDate() + 3)
    d.setUTCHours(15, 0, 0, 0)
    return d
  })()

  /** Devuelve el ActionResult crudo: los casos que esperan éxito lo pasan por
   *  `unwrap`, los que esperan el rechazo por `expectActionError`. */
  async function reservar(key: string, startDateTime: Date = START) {
    const { createBooking } = await import('@/server/actions/bookings')
    return createBooking({
      serviceId, customerName: 'Ana', customerPhone: '+56911300001',
      startDateTime, acceptedTerms: true, idempotencyKey: key,
    }, BIZ)
  }

  /** Vencer el hold es lo que abre la ventana: el horario queda ofrecible para
   *  otra clienta y la reserva, inpagable para `initiatePayment`. */
  function vencerHold(id: string) {
    return prisma.booking.update({
      where: { id },
      data: { holdExpiresAt: new Date(Date.now() - 60 * 60 * 1000) },
    })
  }

  it('con el horario libre devuelve la misma reserva y le renueva el hold', async () => {
    const primera = await unwrap(reservar('retry-key-libre'))

    // El hold se venció mientras la clienta estaba en el checkout. Antes esto
    // dejaba la reserva inpagable Y sin forma de empezar de nuevo: initiatePayment
    // rechaza el hold vencido y "Intentar de nuevo" reusa esta misma key.
    await vencerHold(primera.id)

    const segunda = await unwrap(reservar('retry-key-libre'))

    expect(segunda.id).toBe(primera.id)
    expect(await prisma.booking.count({ where: { businessId: BIZ } })).toBe(1)
    const fila = await prisma.booking.findUnique({ where: { id: primera.id } })
    expect(fila!.status).toBe('pending_payment')
    expect(fila!.holdExpiresAt!.getTime()).toBeGreaterThan(Date.now())
  })

  it('con el horario ya tomado no deja pagar y no toca la reserva', async () => {
    const primera = await unwrap(reservar('retry-key-tomado'))
    await vencerHold(primera.id)

    // Un bloqueo de la dueña encima del horario: es la vía limpia de simularlo,
    // porque el EXCLUDE `Booking_no_overlap` impide crear la reserva rival
    // mientras la nuestra siga `pending_payment`.
    await prisma.timeBlock.create({ data: {
      businessId: BIZ, startDateTime: START, endDateTime: new Date(START.getTime() + 60 * 60 * 1000),
      reason: 'Tapado',
    } })

    await expectActionError(reservar('retry-key-tomado'), 'ya no está disponible')

    // Sin cobro y sin renovación: el hold sigue vencido, y el aviso llega ANTES
    // de mandarla a Mercado Pago, que es todo el punto.
    const fila = await prisma.booking.findUnique({ where: { id: primera.id } })
    expect(fila!.holdExpiresAt!.getTime()).toBeLessThan(Date.now())
    expect(await prisma.booking.count({ where: { businessId: BIZ } })).toBe(1)
  })
})
