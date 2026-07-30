import { PrismaClient, BookingStatus, BookingPaymentStatus, PaymentType } from '@prisma/client'
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { requireTestDatabase } from './setup'
import { applyApprovedPayment } from '@/server/services/finance'

requireTestDatabase()

const BIZ = 'slotrace-biz-1'
const USER = 'slotrace-user-1'

// La carrera pago/hold: el hold de una reserva vence —y deja de bloquear el slot al
// instante, sin esperar al cron—, algo se lleva el horario, y DESPUÉS llega el pago
// de la primera. Antes el flip a `confirmed` no miraba el horario.
//
// Cuánto de esto tapaba ya la DB: la constraint de exclusión `Booking_no_overlap`
// cubre `pending_payment/confirmed/completed`, así que en ESOS estados dos reservas
// solapadas no se pueden ni crear (primer caso de abajo). Lo que queda descubierto y
// este guard ataja: los bloqueos de la dueña (`TimeBlock`, que la constraint no mira)
// y `pending_confirmation` (que se agregó al enum después y nunca entró a la
// constraint).
//
// En los dos casos el pago se asienta igual —el cobro es real— pero la reserva NO se
// confirma y la dueña recibe el aviso.
describe('pago que llega cuando el horario ya se ocupó', () => {
  let prisma: PrismaClient
  let serviceId: string
  let customerId: string

  // Un martes futuro a las 15:00 UTC (12:00 en Santiago): dentro de la regla de
  // disponibilidad y lejos del lead time, para que nada más que el solape pueda
  // rechazar el slot.
  const START = new Date('2027-03-09T15:00:00Z')
  const END = new Date('2027-03-09T16:00:00Z')

  beforeAll(async () => {
    prisma = new PrismaClient()
    await prisma.user.create({ data: { id: USER, email: 'slotrace@t.test', name: 'Owner Race' } })
    await prisma.business.create({ data: {
      id: BIZ, name: 'Race Biz', slug: 'race-biz', subdomain: 'racebiz', ownerUserId: USER,
      city: 'Santiago', country: 'CL', currency: 'CLP', timezone: 'America/Santiago', bookingWindowDays: 400,
    } })
    const customer = await prisma.customer.create({ data: {
      businessId: BIZ, name: 'Cli Race', phone: '+56900000071',
    } })
    customerId = customer.id
    const service = await prisma.service.create({ data: {
      businessId: BIZ, name: 'Sesión Race', durationMinutes: 60, price: 10000,
      depositAmount: 5000, pastelColor: '#FFD700',
    } })
    serviceId = service.id
  })

  afterAll(async () => {
    await prisma.ledgerEntry.deleteMany({ where: { businessId: BIZ } })
    await prisma.payment.deleteMany({ where: { businessId: BIZ } })
    await prisma.booking.deleteMany({ where: { businessId: BIZ } })
    await prisma.timeBlock.deleteMany({ where: { businessId: BIZ } })
    await prisma.service.deleteMany({ where: { businessId: BIZ } })
    await prisma.customer.deleteMany({ where: { businessId: BIZ } })
    await prisma.business.deleteMany({ where: { id: BIZ } })
    await prisma.user.deleteMany({ where: { id: USER } })
    await prisma.$disconnect()
  })

  // Cada caso arranca de cero: si un test dejara su reserva, el siguiente vería
  // un solape que no puso él y pasaría (o fallaría) por el motivo equivocado.
  beforeEach(async () => {
    await prisma.ledgerEntry.deleteMany({ where: { businessId: BIZ } })
    await prisma.payment.deleteMany({ where: { businessId: BIZ } })
    await prisma.booking.deleteMany({ where: { businessId: BIZ } })
    await prisma.timeBlock.deleteMany({ where: { businessId: BIZ } })
  })

  /**
   * La reserva que se lleva el horario mientras la otra espera el pago.
   *
   * Va como `pending_confirmation` y NO como `confirmed` por una razón de fondo, no
   * por comodidad del test: la DB tiene una constraint de exclusión
   * (`Booking_no_overlap`, en la migración `init`) que prohíbe dos reservas solapadas
   * del mismo negocio **mientras su status esté en
   * `('pending_payment','confirmed','completed')`**. Crear una `confirmed` encima de
   * nuestra `pending_payment` es literalmente imposible: Postgres tira 23P01.
   *
   * `pending_confirmation` —una solicitud esperando el visto bueno del negocio— se
   * agregó al enum en `20260729180000_booking_manual_approval` y **nunca se agregó a
   * la constraint**. Así que es un estado real, alcanzable, que la DB no cubre y que
   * el SQL de solape de la app SÍ cuenta como ocupado mientras su hold viva. Es el
   * agujero que este guard tapa.
   */
  function crearReservaGanadora() {
    return prisma.booking.create({ data: {
      businessId: BIZ, serviceId, customerId,
      startDateTime: START, endDateTime: END,
      status: BookingStatus.pending_confirmation,
      // Hold vivo: así el SQL de solape la cuenta como ocupando el horario.
      holdExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      totalPrice: 10000, depositRequired: 5000, depositPaid: 0,
      remainingBalance: 10000, finalAmount: 10000,
      paymentStatus: BookingPaymentStatus.unpaid,
    } })
  }

  /** La reserva que está esperando el pago, con el hold ya vencido. */
  function crearReservaPendiente() {
    return prisma.booking.create({ data: {
      businessId: BIZ, serviceId, customerId,
      startDateTime: START, endDateTime: END,
      status: BookingStatus.pending_payment,
      // Vencido: es justo lo que deja de bloquear el horario y abre la carrera.
      holdExpiresAt: new Date(Date.now() - 60 * 60 * 1000),
      totalPrice: 10000, depositRequired: 5000, depositPaid: 0,
      remainingBalance: 10000, finalAmount: 10000,
      paymentStatus: BookingPaymentStatus.unpaid,
    } })
  }

  function pagarAbono(bookingId: string, providerPaymentId: string) {
    return prisma.$transaction((tx) => applyApprovedPayment({
      tx, bookingId, businessId: BIZ, amount: 5000, currency: 'CLP',
      provider: 'mercado_pago', providerPaymentId, paymentType: PaymentType.deposit,
      // El webhook de MP no pasa esto; acá se salta el chequeo de hold vencido para
      // llegar al guard de cupo, que es lo que este test prueba.
      skipHoldExpiryCheck: true,
    }))
  }

  it('con el horario libre el pago confirma la reserva (control positivo)', async () => {
    const booking = await crearReservaPendiente()

    const res = await pagarAbono(booking.id, 'mp-race-libre')

    expect(res.slotConflict).toBeNull()
    expect(res.wasConfirmed).toBe(true)
    const after = await prisma.booking.findUnique({ where: { id: booking.id } })
    expect(after!.status).toBe(BookingStatus.confirmed)
  })

  it('la DB ya impide dos reservas solapadas en los estados que cubre la constraint', async () => {
    await crearReservaPendiente()

    // Este es el backstop real para `pending_payment/confirmed/completed`, y por eso
    // el caso de abajo usa `pending_confirmation`: acá no hay carrera que ganar, la
    // segunda reserva no se puede ni crear.
    await expect(prisma.booking.create({ data: {
      businessId: BIZ, serviceId, customerId,
      startDateTime: START, endDateTime: END,
      status: BookingStatus.confirmed,
      totalPrice: 10000, depositRequired: 5000, depositPaid: 5000,
      remainingBalance: 5000, finalAmount: 10000,
      paymentStatus: BookingPaymentStatus.deposit_paid,
    } })).rejects.toThrow(/Booking_no_overlap|exclusion constraint/)
  })

  it('con una solicitud encima, asienta la plata y NO confirma', async () => {
    const booking = await crearReservaPendiente()
    const ganadora = await crearReservaGanadora()

    const res = await pagarAbono(booking.id, 'mp-race-pisada')

    // El desenlace: NO se confirmó, y el motivo señala exactamente a la reserva
    // que ganó el horario (una sola, porque cada caso arranca con la tabla limpia).
    expect(res.wasConfirmed).toBe(false)
    expect(res.slotConflict).toEqual({ reason: 'booking_overlap', overlappingBookingIds: [ganadora.id] })

    const after = await prisma.booking.findUnique({ where: { id: booking.id } })
    expect(after!.status).toBe(BookingStatus.pending_payment)

    // Y la plata quedó asentada igual: pago aprobado, asiento en el ledger y el
    // monto visible en la reserva. Si esto no pasara, el cobro de MP quedaría sin
    // rastro en el sistema y nadie podría devolverlo.
    expect(after!.depositPaid).toBe(5000)
    expect(after!.paymentStatus).toBe(BookingPaymentStatus.deposit_paid)
    const pago = await prisma.payment.findFirst({ where: { bookingId: booking.id } })
    expect(pago!.status).toBe('approved')
    const asientos = await prisma.ledgerEntry.findMany({ where: { bookingId: booking.id } })
    expect(asientos).toHaveLength(1)
    expect(asientos[0].amount).toBe(5000)
  })

  it('un bloqueo de la dueña encima del horario también frena la confirmación', async () => {
    const booking = await crearReservaPendiente()
    await prisma.timeBlock.create({ data: {
      businessId: BIZ, startDateTime: START, endDateTime: END, reason: 'Tapado',
    } })

    const res = await pagarAbono(booking.id, 'mp-race-bloqueo')

    expect(res.wasConfirmed).toBe(false)
    expect(res.slotConflict?.reason).toBe('timeblock_overlap')
    const after = await prisma.booking.findUnique({ where: { id: booking.id } })
    expect(after!.status).toBe(BookingStatus.pending_payment)
    expect(after!.depositPaid).toBe(5000)
  })

  it('el redelivery del mismo pago no confirma de rebote ni duplica el asiento', async () => {
    const booking = await crearReservaPendiente()
    await crearReservaGanadora()

    await pagarAbono(booking.id, 'mp-race-redelivery')
    const otraVez = await pagarAbono(booking.id, 'mp-race-redelivery')

    // Mercado Pago reentrega at-least-once: el segundo evento tiene que encontrar
    // el mismo conflicto, no colarse por la rama de idempotencia y confirmar.
    expect(otraVez.wasConfirmed).toBe(false)
    expect(otraVez.slotConflict?.reason).toBe('booking_overlap')
    const asientos = await prisma.ledgerEntry.count({ where: { bookingId: booking.id } })
    expect(asientos).toBe(1)
  })
})
