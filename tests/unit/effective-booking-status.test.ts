import { describe, it, expect } from 'vitest'
import { effectiveBookingStatus } from '@/lib/bookings/status-labels'

const NOW = new Date('2026-08-03T12:00:00Z')
const VIVO = new Date('2026-08-03T18:00:00Z')
const MUERTO = new Date('2026-08-03T09:00:00Z')

describe('effectiveBookingStatus', () => {
  it('con el plazo vivo muestra el status de la base', () => {
    expect(effectiveBookingStatus({ status: 'pending_payment', paymentStatus: 'unpaid', holdExpiresAt: VIVO }, NOW))
      .toBe('pending_payment')
  })

  it('con el plazo vencido adelanta la expiración que el cron va a asentar', () => {
    // El caso que arregla el panel: el cron corre cada hora, y hasta que pasa
    // la fila decía "Pendiente de pago" en naranja sobre algo muerto.
    expect(effectiveBookingStatus({ status: 'pending_payment', paymentStatus: 'unpaid', holdExpiresAt: MUERTO }, NOW))
      .toBe('expired')
  })

  it('la solicitud sin responder también expira sola', () => {
    expect(effectiveBookingStatus({ status: 'pending_confirmation', paymentStatus: 'fully_paid', holdExpiresAt: MUERTO }, NOW))
      .toBe('expired')
  })

  it('con plata adentro NO la da por muerta: el cron tampoco la barre', () => {
    expect(effectiveBookingStatus({ status: 'pending_payment', paymentStatus: 'deposit_paid', holdExpiresAt: MUERTO }, NOW))
      .toBe('pending_payment')
  })

  it('no toca los estados que no dependen del plazo', () => {
    for (const status of ['confirmed', 'completed', 'cancelled', 'no_show', 'expired']) {
      expect(effectiveBookingStatus({ status, paymentStatus: 'unpaid', holdExpiresAt: MUERTO }, NOW)).toBe(status)
    }
  })

  it('acepta el plazo serializado del calendario', () => {
    expect(
      effectiveBookingStatus({ status: 'pending_payment', paymentStatus: 'unpaid', holdExpiresAt: MUERTO.toISOString() }, NOW),
    ).toBe('expired')
  })

  it('sin plazo devuelve el status crudo', () => {
    expect(effectiveBookingStatus({ status: 'pending_payment', paymentStatus: 'unpaid', holdExpiresAt: null }, NOW))
      .toBe('pending_payment')
  })
})
