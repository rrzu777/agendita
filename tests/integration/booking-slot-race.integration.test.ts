import { PrismaClient, BookingStatus, BookingPaymentStatus, PaymentType } from '@prisma/client'
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { requireTestDatabase } from './setup'
import { applyApprovedPayment } from '@/server/services/finance'
import { deriveConfirmationState } from '@/lib/payments/confirmation-state'

requireTestDatabase()

const BIZ = 'slotrace-biz-1'
const USER = 'slotrace-user-1'

// La carrera pago/hold: el hold de una reserva vence —y deja de bloquear el slot al
// instante, sin esperar al cron—, algo se lleva el horario, y DESPUÉS llega el pago
// de la primera. Antes el flip a `confirmed` no miraba el horario.
//
// Cuánto de esto tapa ya la DB: la constraint de exclusión `Booking_no_overlap` cubre
// los cuatro estados activos —`pending_payment/pending_confirmation/confirmed/
// completed`— así que entre reservas de la MISMA persona (o las dos sin persona) el
// solape no se puede ni crear (primer caso de abajo). Lo que queda descubierto y este
// guard ataja son las dos cosas que un EXCLUDE no puede expresar: los bloqueos de la
// dueña (`TimeBlock`, que la constraint no mira) y el caso mixto de persona —una cita
// sin dueño ocupa la hora para todo el equipo, pero para Postgres `''` y `'ana'` son
// valores distintos y no chocan.
//
// La segunda mitad del archivo cubre el otro motivo por el que un pago real puede no
// dejar la reserva en pie: cuando llega, la reserva ya NO está vigente (venció y el
// cron la barrió, la dueña la canceló).
//
// En todos los casos el pago se asienta igual —el cobro es real— pero la reserva NO se
// confirma y la dueña recibe el aviso.
describe('pago que llega y la reserva no queda confirmada', () => {
  let prisma: PrismaClient
  let serviceId: string
  let customerId: string
  let anaId: string

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
    // Existe sólo para poder armar el caso mixto de persona, que es la única forma
    // que queda de tener dos reservas activas encimadas en la base. Ver
    // `crearReservaGanadora`.
    const ana = await prisma.professional.create({ data: { businessId: BIZ, name: 'Ana Race' } })
    anaId = ana.id
  })

  afterAll(async () => {
    await prisma.ledgerEntry.deleteMany({ where: { businessId: BIZ } })
    await prisma.payment.deleteMany({ where: { businessId: BIZ } })
    await prisma.booking.deleteMany({ where: { businessId: BIZ } })
    await prisma.timeBlock.deleteMany({ where: { businessId: BIZ } })
    // Después de las reservas: la FK Booking→Professional es NO ACTION y una reserva
    // viva haría fallar el borrado de la persona.
    await prisma.professional.deleteMany({ where: { businessId: BIZ } })
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
   * **Armarla es más difícil de lo que parece, y el cómo es la mitad del test.** La
   * DB tiene una constraint de exclusión (`Booking_no_overlap`) que prohíbe dos
   * reservas solapadas del mismo negocio en los estados activos: crear una `confirmed`
   * encima de nuestra `pending_payment` es literalmente imposible, Postgres tira
   * 23P01. Antes la escotilla era `pending_confirmation`, que estaba en el enum pero
   * no en la constraint; la migración `booking_overlap_solicitudes` la cerró.
   *
   * La que queda —y no es un truco, es EL agujero que este guard existe para tapar—
   * es el **caso mixto de persona**. La constraint separa por
   * `COALESCE("professionalId", '')`, así que una cita SIN dueño (`''`) y una CON
   * dueño (`'ana'`) son valores distintos y **no chocan para Postgres**. Pero la regla
   * de negocio dice lo contrario: una cita sin dueño ocupa la hora para todo el
   * equipo (`bookingBlocksProfessional`). Esa asimetría no se puede expresar en un
   * EXCLUDE, así que la sostiene sólo la app — y esto es lo que pasa si no la
   * sostiene.
   */
  function crearReservaGanadora() {
    return prisma.booking.create({ data: {
      businessId: BIZ, serviceId, customerId,
      professionalId: null,
      startDateTime: START, endDateTime: END,
      status: BookingStatus.pending_confirmation,
      // Hold vivo: es la solicitud "en pie", el caso que le interesa al test. Con el
      // hold vencido taparía igual — está en el EXCLUDE — pero sería otro escenario.
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
      professionalId: anaId,
      startDateTime: START, endDateTime: END,
      status: BookingStatus.pending_payment,
      // Vencido: es justo lo que deja de bloquear el horario y abre la carrera.
      holdExpiresAt: new Date(Date.now() - 60 * 60 * 1000),
      totalPrice: 10000, depositRequired: 5000, depositPaid: 0,
      remainingBalance: 10000, finalAmount: 10000,
      paymentStatus: BookingPaymentStatus.unpaid,
    } })
  }

  /** El cobro tal como lo asienta el webhook de MP: `recordEvenIfNotPayable`, que es
   *  lo que evita que un pago real termine en 500 + reintentos eternos de MP. */
  function pagarAbono(bookingId: string, providerPaymentId: string) {
    return prisma.$transaction((tx) => applyApprovedPayment({
      tx, bookingId, businessId: BIZ, amount: 5000, currency: 'CLP',
      provider: 'mercado_pago', providerPaymentId, paymentType: PaymentType.deposit,
      recordEvenIfNotPayable: true,
    }))
  }

  it('con el horario libre el pago confirma la reserva (control positivo)', async () => {
    const booking = await crearReservaPendiente()

    const res = await pagarAbono(booking.id, 'mp-race-libre')

    expect(res.unconfirmedReason).toBeNull()
    expect(res.wasConfirmed).toBe(true)
    const after = await prisma.booking.findUnique({ where: { id: booking.id } })
    expect(after!.status).toBe(BookingStatus.confirmed)
  })

  it('la DB ya impide dos reservas solapadas de la misma persona', async () => {
    await crearReservaPendiente()

    // El backstop real: acá no hay carrera que ganar, la segunda reserva no se puede
    // ni crear. Va a nombre de Ana igual que la pendiente — con la persona adentro del
    // EXCLUDE, dos reservas de personas distintas SÍ pueden convivir, que es justo la
    // capacidad del multi-profesional.
    await expect(prisma.booking.create({ data: {
      businessId: BIZ, serviceId, customerId,
      professionalId: anaId,
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
    expect(res.unconfirmedReason).toEqual({ kind: 'slot_taken', conflict: { reason: 'booking_overlap', overlappingBookingIds: [ganadora.id] } })

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

  // La otra punta del mismo hecho: lo que ve la clienta. Esa fila —pago aprobado,
  // reserva sin confirmar— es la que lee `/book/confirmation`, que es la URL de retorno
  // de Mercado Pago. Antes la pantalla deducía "Reserva confirmada" del pago aprobado y
  // le prometía el día y la hora a alguien cuyo horario ya era de otra persona. Va acá
  // y no en un unit test porque lo que puede volver a romperse es la correspondencia
  // entre los campos que escribe `recalcBookingFromPayments` y los que lee la pantalla.
  it('la pantalla de la clienta no dice "confirmada" con el horario perdido', async () => {
    const booking = await crearReservaPendiente()
    await crearReservaGanadora()

    await pagarAbono(booking.id, 'mp-race-pantalla')

    const fila = await prisma.booking.findUnique({
      where: { id: booking.id },
      include: { payments: { select: { status: true, provider: true, providerPaymentId: true } } },
    })
    expect(deriveConfirmationState(fila!)).toBe('paid_unconfirmed')
  })

  it('un bloqueo de la dueña encima del horario también frena la confirmación', async () => {
    const booking = await crearReservaPendiente()
    await prisma.timeBlock.create({ data: {
      businessId: BIZ, startDateTime: START, endDateTime: END, reason: 'Tapado',
    } })

    const res = await pagarAbono(booking.id, 'mp-race-bloqueo')

    expect(res.wasConfirmed).toBe(false)
    expect(res.unconfirmedReason).toEqual({ kind: 'slot_taken', conflict: { reason: 'timeblock_overlap' } })
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
    expect(otraVez.unconfirmedReason?.kind).toBe('slot_taken')
    const asientos = await prisma.ledgerEntry.count({ where: { bookingId: booking.id } })
    expect(asientos).toBe(1)
  })

  // ─── La otra mitad: la reserva ya no está vigente cuando llega el pago ───
  // MP puede aprobar horas o días después (medios en efectivo, revisión de la
  // tarjeta), y el cron de holds corre cada hora: cuando el webhook llega, la
  // reserva ya es `expired`. Sin `recordEvenIfNotPayable` esto lanzaba, el webhook
  // devolvía 500 y MP reintentaba el mismo evento para siempre — con el cobro real
  // sin asentar en ningún lado.
  const NO_VIGENTES = [BookingStatus.expired, BookingStatus.cancelled, BookingStatus.no_show] as const

  for (const status of NO_VIGENTES) {
    it(`reserva ${status}: asienta la plata, no la toca y devuelve el motivo`, async () => {
      const booking = await prisma.booking.create({ data: {
        businessId: BIZ, serviceId, customerId,
        startDateTime: START, endDateTime: END,
        status,
        totalPrice: 10000, depositRequired: 5000, depositPaid: 0,
        remainingBalance: 10000, finalAmount: 10000,
        paymentStatus: BookingPaymentStatus.unpaid,
      } })

      const res = await pagarAbono(booking.id, `mp-novigente-${status}`)

      expect(res.wasConfirmed).toBe(false)
      expect(res.unconfirmedReason).toEqual({ kind: 'booking_status', status })

      // La reserva NO se revive: sacarla de ese estado es decisión de la dueña
      // (`reviveBooking`), no efecto colateral de un webhook.
      const after = await prisma.booking.findUnique({ where: { id: booking.id } })
      expect(after!.status).toBe(status)

      // Pero la plata sí queda asentada y trazable, que es todo el punto.
      const pago = await prisma.payment.findFirst({ where: { bookingId: booking.id } })
      expect(pago!.status).toBe('approved')
      expect(after!.depositPaid).toBe(5000)

      // Como `overpayment` y NO como `deposit_paid`: es un cobro que se va a
      // devolver o reacomodar, contarlo como facturación infla ingresos que se
      // revierten. Mismo criterio que la rama de paquetes.
      const asientos = await prisma.ledgerEntry.findMany({ where: { bookingId: booking.id } })
      expect(asientos).toHaveLength(1)
      expect(asientos[0].type).toBe('overpayment')
      expect(asientos[0].amount).toBe(5000)
    })
  }

  it('sin la bandera del webhook, una reserva no vigente sigue rechazando el pago', async () => {
    const booking = await prisma.booking.create({ data: {
      businessId: BIZ, serviceId, customerId,
      startDateTime: START, endDateTime: END,
      status: BookingStatus.expired,
      totalPrice: 10000, depositRequired: 5000, depositPaid: 0,
      remainingBalance: 10000, finalAmount: 10000,
      paymentStatus: BookingPaymentStatus.unpaid,
    } })

    // Control negativo de la bandera: los caminos interactivos (pago manual de la
    // dueña, verificación post-checkout) SÍ tienen una pantalla donde decir que no,
    // y tienen que seguir diciéndolo. Si este test empezara a pasar en verde con la
    // bandera puesta, el flag no estaría haciendo nada.
    await expect(prisma.$transaction((tx) => applyApprovedPayment({
      tx, bookingId: booking.id, businessId: BIZ, amount: 5000, currency: 'CLP',
      provider: 'manual', providerPaymentId: null, paymentType: PaymentType.deposit,
    }))).rejects.toThrow(/No se puede procesar pago/)

    const pagos = await prisma.payment.count({ where: { bookingId: booking.id } })
    expect(pagos).toBe(0)
  })
})
