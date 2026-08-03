import { PrismaClient, BookingStatus, BookingPaymentStatus } from '@prisma/client'
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { requireTestDatabase } from './setup'
import { assertSlotFreeOfConflicts } from '@/lib/availability/validation'
import { BANK_TRANSFER_METHOD } from '@/lib/bank-transfer/declared'
import { MANUAL_COORDINATION_METHOD } from '@/lib/bookings/hold'

requireTestDatabase()

const BIZ = 'stalehold-biz-1'
const USER = 'stalehold-user-1'

/**
 * El desacuerdo entre la agenda y la base: el EXCLUDE `Booking_no_overlap` (SQL a
 * mano en la migración `init`, invisible en schema.prisma) mira SÓLO el status, así
 * que una reserva `pending_payment` con el hold vencido le sigue tapando el horario
 * a Postgres. La app, en cambio, daba ese horario por libre — y el insert moría con
 * 23P01, que Prisma entrega como `PrismaClientUnknownRequestError` (sin `.code`), o
 * sea "Ocurrió un error inesperado" sobre un horario que la pantalla ofrecía.
 *
 * Estos tests corren contra la constraint de verdad, que es el único juez: cada caso
 * termina intentando crear la reserva que el usuario habría intentado crear.
 */
describe('holds vencidos vs Booking_no_overlap', () => {
  let prisma: PrismaClient
  let serviceId: string
  let customerId: string

  // Un martes futuro a las 15:00 UTC (12:00 en Santiago).
  const START = new Date('2027-04-13T15:00:00Z')
  const END = new Date('2027-04-13T16:00:00Z')
  const TZ = 'America/Santiago'
  const VENCIDO = () => new Date(Date.now() - 60 * 60 * 1000)
  const VIVO = () => new Date(Date.now() + 60 * 60 * 1000)

  beforeAll(async () => {
    prisma = new PrismaClient()
    await prisma.user.create({ data: { id: USER, email: 'stalehold@t.test', name: 'Owner Stale' } })
    await prisma.business.create({ data: {
      id: BIZ, name: 'Stale Biz', slug: 'stale-biz', subdomain: 'stalebiz', ownerUserId: USER,
      city: 'Santiago', country: 'CL', currency: 'CLP', timezone: TZ, bookingWindowDays: 400,
    } })
    const customer = await prisma.customer.create({ data: {
      businessId: BIZ, name: 'Cli Stale', phone: '+56900000081',
    } })
    customerId = customer.id
    const service = await prisma.service.create({ data: {
      businessId: BIZ, name: 'Sesión Stale', durationMinutes: 60, price: 10000,
      depositAmount: 5000, pastelColor: '#FFD700',
    } })
    serviceId = service.id
  })

  afterAll(async () => {
    await prisma.promotionRedemption.deleteMany({ where: { businessId: BIZ } })
    await prisma.promotion.deleteMany({ where: { businessId: BIZ } })
    await prisma.booking.deleteMany({ where: { businessId: BIZ } })
    await prisma.service.deleteMany({ where: { businessId: BIZ } })
    await prisma.customer.deleteMany({ where: { businessId: BIZ } })
    await prisma.business.deleteMany({ where: { id: BIZ } })
    await prisma.user.deleteMany({ where: { id: USER } })
    await prisma.$disconnect()
  })

  // Cada caso arranca de cero: una reserva olvidada por el test anterior sería un
  // solape que nadie puso, y el caso pasaría (o fallaría) por el motivo equivocado.
  beforeEach(async () => {
    await prisma.promotionRedemption.deleteMany({ where: { businessId: BIZ } })
    await prisma.booking.deleteMany({ where: { businessId: BIZ } })
  })

  /** Una reserva esperando el pago, con el hold como lo pida cada caso. */
  function crearHold(over: {
    holdExpiresAt: Date | null
    paymentStatus?: BookingPaymentStatus
    paymentMethod?: string | null
    depositPaid?: number
  }) {
    return prisma.booking.create({ data: {
      businessId: BIZ, serviceId, customerId,
      startDateTime: START, endDateTime: END,
      status: BookingStatus.pending_payment,
      holdExpiresAt: over.holdExpiresAt,
      totalPrice: 10000, depositRequired: 5000, depositPaid: over.depositPaid ?? 0,
      remainingBalance: 10000, finalAmount: 10000,
      paymentStatus: over.paymentStatus ?? BookingPaymentStatus.unpaid,
      paymentMethod: over.paymentMethod ?? null,
    } })
  }

  /** El chequeo tal como lo corre la app: adentro de una transacción, que es donde
   *  el advisory lock y el `FOR UPDATE` valen algo. */
  function chequearSlot() {
    return prisma.$transaction((tx) => assertSlotFreeOfConflicts({
      tx, businessId: BIZ, startDateTime: START, endDateTime: END, timezone: TZ,
      professionalId: null,
    }))
  }

  /** Lo que hace la clienta después de que la pantalla le ofreció el horario. Es el
   *  único juez de si el fix sirve: acá muerde la constraint o no muerde. */
  function reservarEseHorario() {
    return prisma.booking.create({ data: {
      businessId: BIZ, serviceId, customerId,
      startDateTime: START, endDateTime: END,
      status: BookingStatus.confirmed,
      totalPrice: 10000, depositRequired: 5000, depositPaid: 5000,
      remainingBalance: 5000, finalAmount: 10000,
      paymentStatus: BookingPaymentStatus.deposit_paid,
    } })
  }

  it('un checkout abandonado se marca expired y el horario queda realmente reservable', async () => {
    const abandonada = await crearHold({ holdExpiresAt: VENCIDO() })

    await expect(chequearSlot()).resolves.toBeUndefined()

    // Lo que arregla el bug: la fila salió de `pending_payment`, así que el EXCLUDE
    // ya no la ve. Antes el chequeo pasaba igual pero la fila seguía ahí.
    const after = await prisma.booking.findUnique({ where: { id: abandonada.id } })
    expect(after!.status).toBe(BookingStatus.expired)

    // Y la prueba de fuego: la reserva que antes moría con 23P01 ahora entra.
    await expect(reservarEseHorario()).resolves.toBeTruthy()
  })

  it('el sweep libera el canje de promo de la reserva que barrió', async () => {
    const abandonada = await crearHold({ holdExpiresAt: VENCIDO() })
    const promo = await prisma.promotion.create({ data: {
      businessId: BIZ, name: 'Promo Stale', code: 'STALE10',
      rewardType: 'fixed_amount', rewardValue: 1000, redemptionCount: 1,
    } })
    await prisma.promotionRedemption.create({ data: {
      businessId: BIZ, promotionId: promo.id, bookingId: abandonada.id, customerId,
      discountAmount: 1000, source: 'public_booking',
    } })

    await chequearSlot()

    // Sin esto el canje quedaría consumido para siempre por una reserva que no
    // existe más, y la promo perdería un cupo de su tope.
    const canje = await prisma.promotionRedemption.findUnique({ where: { bookingId: abandonada.id } })
    expect(canje!.status).toBe('released')
    expect(canje!.releaseReason).toBe('hold_expired')
    const after = await prisma.promotion.findUnique({ where: { id: promo.id } })
    expect(after!.redemptionCount).toBe(0)
  })

  it('con el hold vivo el horario sigue ocupado y nada se barre', async () => {
    const viva = await crearHold({ holdExpiresAt: VIVO() })

    await expect(chequearSlot()).rejects.toThrow('Ese horario ya no está disponible')
    const after = await prisma.booking.findUnique({ where: { id: viva.id } })
    expect(after!.status).toBe(BookingStatus.pending_payment)
  })

  // Las dos familias que ningún sweep puede tocar. Antes la app las daba por libres
  // y el insert explotaba; ahora las rechaza con el mensaje que corresponde.
  it('un hold vencido CON plata encima sigue ocupando el horario', async () => {
    const conPlata = await crearHold({
      holdExpiresAt: VENCIDO(),
      paymentStatus: BookingPaymentStatus.deposit_paid,
      depositPaid: 5000,
    })

    await expect(chequearSlot()).rejects.toThrow('Ese horario ya no está disponible')

    const after = await prisma.booking.findUnique({ where: { id: conPlata.id } })
    expect(after!.status).toBe(BookingStatus.pending_payment)
    // Y la BD coincide con el rechazo: reservar encima era imposible de todas formas.
    await expect(reservarEseHorario()).rejects.toThrow(/Booking_no_overlap|exclusion constraint/)
  })

  it('un hold vencido con transferencia bancaria sigue ocupando: lo barre el cron, con aviso', async () => {
    const transferencia = await crearHold({
      holdExpiresAt: VENCIDO(),
      paymentMethod: BANK_TRANSFER_METHOD,
    })

    await expect(chequearSlot()).rejects.toThrow('Ese horario ya no está disponible')

    const after = await prisma.booking.findUnique({ where: { id: transferencia.id } })
    expect(after!.status).toBe(BookingStatus.pending_payment)
  })

  it('un hold vencido de coordinación manual sigue ocupando: lo barre el cron, con aviso', async () => {
    const manual = await crearHold({
      holdExpiresAt: VENCIDO(),
      paymentMethod: MANUAL_COORDINATION_METHOD,
    })

    await expect(chequearSlot()).rejects.toThrow('Ese horario ya no está disponible')

    const after = await prisma.booking.findUnique({ where: { id: manual.id } })
    expect(after!.status).toBe(BookingStatus.pending_payment)
  })
})
