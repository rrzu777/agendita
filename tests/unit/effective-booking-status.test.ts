import { describe, it, expect } from 'vitest'
import { effectiveBookingStatus, HOLD_EXPIRED_STATUS } from '@/lib/bookings/status-labels'

const NOW = new Date('2026-08-03T12:00:00Z')
const VIVO = new Date('2026-08-03T18:00:00Z')
const MUERTO = new Date('2026-08-03T09:00:00Z')

describe('effectiveBookingStatus', () => {
  it('con el plazo vivo muestra el status de la base', () => {
    expect(effectiveBookingStatus({ status: 'pending_payment', paymentStatus: 'unpaid', holdExpiresAt: VIVO }, NOW))
      .toBe('pending_payment')
  })

  it('con el plazo vencido lo dice, sin hacerla pasar por expirada', () => {
    // El caso que arregla el panel: el cron corre cada hora, y hasta que pasa la
    // fila decía "Pendiente de pago" en naranja sobre algo que el server ya no
    // deja cobrar. La clave NO es `expired` a propósito — ese estado en el panel
    // viene con "Revivir" al lado, y ese botón todavía no existe para esta fila.
    expect(effectiveBookingStatus({ status: 'pending_payment', paymentStatus: 'unpaid', holdExpiresAt: MUERTO }, NOW))
      .toBe(HOLD_EXPIRED_STATUS)
    expect(HOLD_EXPIRED_STATUS).not.toBe('expired')
  })

  it('la solicitud sin responder NO se toca, aunque el cron la vaya a expirar', () => {
    // La dueña todavía puede aceptarla: VALID_STATUS_TRANSITIONS permite
    // pending_confirmation → confirmed sin mirar el hold, y aprobar limpia el
    // plazo. Rotularla vencida al lado de un "Aceptar" que funciona la haría
    // abandonar una reserva que estaba a un clic de salvarse.
    expect(effectiveBookingStatus({ status: 'pending_confirmation', paymentStatus: 'fully_paid', holdExpiresAt: MUERTO }, NOW))
      .toBe('pending_confirmation')
  })

  it('con plata adentro NO la da por vencida: el cron tampoco la barre', () => {
    expect(effectiveBookingStatus({ status: 'pending_payment', paymentStatus: 'deposit_paid', holdExpiresAt: MUERTO }, NOW))
      .toBe('pending_payment')
  })

  it('no toca los estados que no dependen del plazo', () => {
    for (const status of ['confirmed', 'completed', 'cancelled', 'no_show', 'expired']) {
      expect(effectiveBookingStatus({ status, paymentStatus: 'unpaid', holdExpiresAt: MUERTO }, NOW)).toBe(status)
    }
  })

  it('sin plazo devuelve el status crudo', () => {
    expect(effectiveBookingStatus({ status: 'pending_payment', paymentStatus: 'unpaid', holdExpiresAt: null }, NOW))
      .toBe('pending_payment')
  })
})
