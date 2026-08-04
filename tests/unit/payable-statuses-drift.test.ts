import { describe, it, expect } from 'vitest'
import { BookingStatus, BookingPaymentStatus } from '@prisma/client'
import { isManualPaymentAllowed } from '@/components/dashboard/manual-payment-utils'
import { assertBookingPayable } from '@/lib/bookings/payments'

// Test anti-drift (hallazgo del review de FU-B4b-3): la UI (botón de pago
// manual) y el server (assertBookingPayable con allowCompleted) deben derivar
// de las MISMAS condiciones. Si alguien mueve una y no la otra, esto lo delata.
function serverAllows(status: BookingStatus, holdExpiresAt: Date | null, paymentStatus: string): boolean {
  try {
    assertBookingPayable({ status, holdExpiresAt, paymentStatus }, { allowCompleted: true })
    return true
  } catch {
    return false
  }
}

const UI_BOOKING = { remainingBalance: 8000 }

describe('estados pagables — UI y server no driftean', () => {
  it.each(Object.values(BookingStatus))('%s: UI y server coinciden', (status) => {
    expect(isManualPaymentAllowed({ ...UI_BOOKING, status, holdExpiresAt: null, paymentStatus: 'unpaid' }))
      .toBe(serverAllows(status, null, 'unpaid'))
  })

  it('completed sin allowCompleted sigue siendo terminal en el server', () => {
    expect(() =>
      assertBookingPayable({ status: BookingStatus.completed, holdExpiresAt: null, paymentStatus: 'unpaid' }),
    ).toThrow('No se puede procesar pago')
  })

  it('estados muertos rechazan en ambos lados', () => {
    for (const status of [BookingStatus.cancelled, BookingStatus.expired, BookingStatus.no_show]) {
      expect(isManualPaymentAllowed({ ...UI_BOOKING, status, holdExpiresAt: null, paymentStatus: 'unpaid' })).toBe(false)
      expect(serverAllows(status, null, 'unpaid')).toBe(false)
    }
  })

  // El SEGUNDO guard del server (plazo vencido) también tiene que estar
  // espejado: sin esto la UI ofrecía "Cobrar" y el clic moría en un error que
  // no explicaba nada. `assertBookingPayable` compara contra su propio
  // `new Date()`, así que los plazos van relativos al reloj real.
  //
  // El barrido incluye `paymentStatus` porque ése es el eje donde las dos
  // copias se habían separado del CRON: con plata adentro la reserva no se
  // barre, y las dos tienen que dejar cobrar. Recorrer el enum entero es lo que
  // hace que un valor nuevo tenga que decidirse en los dos lados a la vez.
  const PLAZOS: Array<[string, () => Date | null]> = [
    ['sin plazo', () => null],
    ['con el plazo vencido', () => new Date(Date.now() - 60_000)],
    ['con el plazo vivo', () => new Date(Date.now() + 60 * 60_000)],
  ]

  for (const [nombrePlazo, plazo] of PLAZOS) {
    it.each(
      Object.values(BookingStatus).flatMap((status) =>
        Object.values(BookingPaymentStatus).map((paymentStatus) => [status, paymentStatus] as const),
      ),
    )(`%s + %s: ${nombrePlazo}, UI y server coinciden`, (status, paymentStatus) => {
      const holdExpiresAt = plazo()
      expect(isManualPaymentAllowed({ ...UI_BOOKING, status, holdExpiresAt, paymentStatus }))
        .toBe(serverAllows(status, holdExpiresAt, paymentStatus))
    })
  }

  // El caso concreto que motivó el eje nuevo, escrito aparte del barrido para
  // que se lea qué se arregló: pending_payment con el plazo vencido y el abono
  // ya cobrado (la rama `slotConflict` de recalcBookingFromPayments). El cron
  // filtra `unpaid`, así que nunca la expira — cerrarle el cobro la dejaba sin
  // ninguna salida, ni cobrar ni Revivir.
  it('pending_payment con plazo vencido y abono adentro se puede cobrar en los dos lados', () => {
    const vencido = new Date(Date.now() - 60_000)
    expect(serverAllows(BookingStatus.pending_payment, vencido, BookingPaymentStatus.deposit_paid)).toBe(true)
    expect(isManualPaymentAllowed({
      ...UI_BOOKING,
      status: BookingStatus.pending_payment,
      holdExpiresAt: vencido,
      paymentStatus: BookingPaymentStatus.deposit_paid,
    })).toBe(true)
  })
})
