import { describe, it, expect } from 'vitest'
import { BookingStatus } from '@prisma/client'
import { isManualPaymentAllowed } from '@/components/dashboard/manual-payment-utils'
import { assertBookingPayable } from '@/lib/bookings/payments'

// Test anti-drift (hallazgo del review de FU-B4b-3): la UI (botón de pago
// manual) y el server (assertBookingPayable con allowCompleted) deben derivar
// de las MISMAS condiciones. Si alguien mueve una y no la otra, esto lo delata.
function serverAllows(status: BookingStatus, holdExpiresAt: Date | null): boolean {
  try {
    assertBookingPayable({ status, holdExpiresAt }, { allowCompleted: true })
    return true
  } catch {
    return false
  }
}

describe('estados pagables — UI y server no driftean', () => {
  it.each(Object.values(BookingStatus))('%s: UI y server coinciden', (status) => {
    expect(isManualPaymentAllowed({ status, remainingBalance: 8000, holdExpiresAt: null }))
      .toBe(serverAllows(status, null))
  })

  it('completed sin allowCompleted sigue siendo terminal en el server', () => {
    expect(() =>
      assertBookingPayable({ status: BookingStatus.completed, holdExpiresAt: null }),
    ).toThrow('No se puede procesar pago')
  })

  it('estados muertos rechazan en ambos lados', () => {
    for (const status of [BookingStatus.cancelled, BookingStatus.expired, BookingStatus.no_show]) {
      expect(isManualPaymentAllowed({ status, remainingBalance: 8000, holdExpiresAt: null })).toBe(false)
      expect(serverAllows(status, null)).toBe(false)
    }
  })

  // El SEGUNDO guard del server (plazo vencido) también tiene que estar
  // espejado: sin esto la UI ofrecía "Cobrar" y el clic moría en un error que
  // no explicaba nada. `assertBookingPayable` compara contra su propio
  // `new Date()`, así que los plazos van relativos al reloj real.
  it.each(Object.values(BookingStatus))('%s: con el plazo vencido coinciden', (status) => {
    const vencido = new Date(Date.now() - 60_000)
    expect(isManualPaymentAllowed({ status, remainingBalance: 8000, holdExpiresAt: vencido }))
      .toBe(serverAllows(status, vencido))
  })

  it.each(Object.values(BookingStatus))('%s: con el plazo vivo coinciden', (status) => {
    const vivo = new Date(Date.now() + 60 * 60_000)
    expect(isManualPaymentAllowed({ status, remainingBalance: 8000, holdExpiresAt: vivo }))
      .toBe(serverAllows(status, vivo))
  })
})
