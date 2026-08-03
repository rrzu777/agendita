import { describe, it, expect } from 'vitest'
import { isManualPaymentAllowed } from '@/components/dashboard/manual-payment-utils'

const NOW = new Date('2026-08-03T12:00:00Z')
const VIVO = new Date('2026-08-03T18:00:00Z')
const MUERTO = new Date('2026-08-03T09:00:00Z')

describe('isManualPaymentAllowed', () => {
  it('permite pending_payment y confirmed con saldo (comportamiento actual)', () => {
    expect(isManualPaymentAllowed({ status: 'pending_payment', remainingBalance: 8000, holdExpiresAt: VIVO }, NOW)).toBe(true)
    expect(isManualPaymentAllowed({ status: 'confirmed', remainingBalance: 8000, holdExpiresAt: null }, NOW)).toBe(true)
  })

  it('permite completed con saldo (recobro post-chargeback)', () => {
    expect(isManualPaymentAllowed({ status: 'completed', remainingBalance: 8000, holdExpiresAt: null }, NOW)).toBe(true)
  })

  it('sigue rechazando completed sin saldo y estados muertos', () => {
    expect(isManualPaymentAllowed({ status: 'completed', remainingBalance: 0, holdExpiresAt: null }, NOW)).toBe(false)
    expect(isManualPaymentAllowed({ status: 'cancelled', remainingBalance: 8000, holdExpiresAt: null }, NOW)).toBe(false)
    expect(isManualPaymentAllowed({ status: 'expired', remainingBalance: 8000, holdExpiresAt: null }, NOW)).toBe(false)
    expect(isManualPaymentAllowed({ status: 'no_show', remainingBalance: 8000, holdExpiresAt: null }, NOW)).toBe(false)
  })

  it('con el plazo vencido no ofrece cobrar: el server lo rechaza', () => {
    expect(isManualPaymentAllowed({ status: 'pending_payment', remainingBalance: 8000, holdExpiresAt: MUERTO }, NOW)).toBe(false)
  })

  it('el plazo vencido sólo pesa en pending_payment', () => {
    // Espejo del guard del server: una confirmada ya no depende del hold —
    // puede tener uno viejo escrito y el cobro sigue siendo legítimo.
    expect(isManualPaymentAllowed({ status: 'confirmed', remainingBalance: 8000, holdExpiresAt: MUERTO }, NOW)).toBe(true)
    expect(isManualPaymentAllowed({ status: 'completed', remainingBalance: 8000, holdExpiresAt: MUERTO }, NOW)).toBe(true)
  })

  it('acepta el plazo serializado del calendario', () => {
    // CalendarBooking viaja con las fechas en string; sin normalizar, la
    // comparación con `now` daría siempre false y el botón volvería.
    expect(
      isManualPaymentAllowed({ status: 'pending_payment', remainingBalance: 8000, holdExpiresAt: MUERTO.toISOString() }, NOW),
    ).toBe(false)
  })
})
