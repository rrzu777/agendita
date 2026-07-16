import { describe, it, expect } from 'vitest'
import { BookingStatus } from '@prisma/client'
import { isManualPaymentAllowed } from '@/components/dashboard/manual-payment-utils'
import { assertBookingPayable } from '@/lib/booking-payments'

// Test anti-drift (hallazgo del review de FU-B4b-3): la UI (botón de pago
// manual) y el server (assertBookingPayable con allowCompleted) deben derivar
// del MISMO conjunto de estados pagables. Si alguien agrega un status a un
// lado y no al otro, esto lo delata.
describe('estados pagables — UI y server no driftean', () => {
  it.each(Object.values(BookingStatus))('%s: UI y server coinciden', (status) => {
    const uiAllows = isManualPaymentAllowed({ status, remainingBalance: 8000 })
    let serverAllows = true
    try {
      assertBookingPayable(
        { status, holdExpiresAt: null },
        { allowCompleted: true },
      )
    } catch {
      serverAllows = false
    }
    expect(uiAllows).toBe(serverAllows)
  })

  it('completed sin allowCompleted sigue siendo terminal en el server', () => {
    expect(() =>
      assertBookingPayable({ status: BookingStatus.completed, holdExpiresAt: null }),
    ).toThrow('No se puede procesar pago')
  })

  it('estados muertos rechazan en ambos lados', () => {
    for (const status of [BookingStatus.cancelled, BookingStatus.expired, BookingStatus.no_show]) {
      expect(isManualPaymentAllowed({ status, remainingBalance: 8000 })).toBe(false)
      expect(() =>
        assertBookingPayable({ status, holdExpiresAt: null }, { allowCompleted: true }),
      ).toThrow()
    }
  })
})
