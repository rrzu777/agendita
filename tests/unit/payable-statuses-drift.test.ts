import { describe, it, expect } from 'vitest'
import { BookingStatus, BookingPaymentStatus } from '@prisma/client'
import { isManualPaymentAllowed } from '@/components/dashboard/manual-payment-utils'
import { assertBookingPayable } from '@/lib/bookings/payments'

// Test anti-drift (hallazgo del review de FU-B4b-3): la UI (botón de pago
// manual) y el server (assertBookingPayable con allowCompleted) deben derivar
// de las MISMAS condiciones. Si alguien mueve una y no la otra, esto lo delata.
//
// Los dos lados envueltos igual, para que el assert se lea como lo que es: una
// comparación entre dos respuestas a la misma pregunta.
function serverAllows(
  status: BookingStatus,
  holdExpiresAt: Date | null,
  paymentStatus: BookingPaymentStatus,
): boolean {
  try {
    assertBookingPayable({ status, holdExpiresAt, paymentStatus }, { allowCompleted: true })
    return true
  } catch {
    return false
  }
}

// El reloj de la UI. Capturado una vez y no por llamada: el server (`assert‐
// BookingPayable`) usa el suyo, así que los dos tienen que mirar el mismo
// instante para que la comparación signifique algo. Los plazos de abajo se
// arman contra ÉL.
const NOW = new Date()

function uiAllows(
  status: BookingStatus,
  holdExpiresAt: Date | null,
  paymentStatus: BookingPaymentStatus,
): boolean {
  return isManualPaymentAllowed({ status, holdExpiresAt, paymentStatus, remainingBalance: 8000 }, NOW)
}

// El barrido cubre las tres dimensiones que leen los dos guards. El eje de
// `paymentStatus` es el que faltaba, y es justo donde las dos copias se habían
// separado del CRON: con plata adentro la reserva no se barre, así que el plazo
// vencido no la condena y las dos tienen que dejar cobrar. Recorrer los enums
// enteros es lo que obliga a decidir un valor nuevo en los dos lados a la vez.
//
// Los plazos van como offset en ms y no como Date: `assertBookingPayable`
// compara contra su propio `new Date()`, así que la fecha se arma adentro del
// caso, contra el reloj real.
const PLAZOS = [
  ['sin plazo', null],
  ['con el plazo vencido', -60_000],
  ['con el plazo vivo', 60 * 60_000],
] as const

const CASOS = PLAZOS.flatMap(([plazo, offset]) =>
  Object.values(BookingStatus).flatMap((status) =>
    Object.values(BookingPaymentStatus).map(
      (paymentStatus) => [plazo, status, paymentStatus, offset] as const,
    ),
  ),
)

describe('estados pagables — UI y server no driftean', () => {
  it.each(CASOS)('%s, %s + %s: UI y server coinciden', (_plazo, status, paymentStatus, offset) => {
    const holdExpiresAt = offset == null ? null : new Date(NOW.getTime() + offset)
    expect(uiAllows(status, holdExpiresAt, paymentStatus))
      .toBe(serverAllows(status, holdExpiresAt, paymentStatus))
  })

  it('completed sin allowCompleted sigue siendo terminal en el server', () => {
    expect(() =>
      assertBookingPayable({
        status: BookingStatus.completed,
        holdExpiresAt: null,
        paymentStatus: BookingPaymentStatus.unpaid,
      }),
    ).toThrow('No se puede procesar pago')
  })

  // Los dos anclas que el barrido NO da: él sólo compara los lados entre sí, así
  // que "los dos dicen que no" y "los dos dicen que sí" le dan igual. Estos
  // fijan el VALOR, que es lo que se rompería sin que nadie se entere.
  it('estados muertos rechazan en ambos lados', () => {
    for (const status of [BookingStatus.cancelled, BookingStatus.expired, BookingStatus.no_show]) {
      expect(uiAllows(status, null, BookingPaymentStatus.unpaid)).toBe(false)
      expect(serverAllows(status, null, BookingPaymentStatus.unpaid)).toBe(false)
    }
  })

  it('pending_payment con plazo vencido y abono adentro se puede cobrar en los dos lados', () => {
    // El caso que motivó el eje nuevo: la rama `slotConflict` de
    // `recalcBookingFromPayments` deja la reserva así. El cron filtra `unpaid`,
    // o sea que nunca la expira — cerrarle el cobro la dejaba sin ninguna
    // salida, ni cobrar ni el `expired` que habilita Revivir.
    const vencido = new Date(Date.now() - 60_000)
    expect(serverAllows(BookingStatus.pending_payment, vencido, BookingPaymentStatus.deposit_paid)).toBe(true)
    expect(uiAllows(BookingStatus.pending_payment, vencido, BookingPaymentStatus.deposit_paid)).toBe(true)
  })
})
