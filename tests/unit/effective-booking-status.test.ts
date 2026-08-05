import { describe, it, expect } from 'vitest'
import {
  bookingStatusLabel,
  displayedBookingStatus,
  effectiveBookingStatus,
  HOLD_EXPIRED_LABEL,
  HOLD_EXPIRED_STATUS,
} from '@/lib/bookings/status-labels'
import { btBalanceId, btDeclaredId } from '@/lib/bank-transfer/declared'

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

describe('displayedBookingStatus', () => {
  const vencida = (payments: Array<{
    provider: string
    status: string
    providerPaymentId?: string | null
  }>) => ({
    status: 'pending_payment',
    paymentStatus: 'unpaid',
    holdExpiresAt: MUERTO,
    payments,
  })

  it('sin pagos declarados se comporta como effectiveBookingStatus', () => {
    expect(displayedBookingStatus(vencida([]), NOW)).toBe(HOLD_EXPIRED_STATUS)
  })

  it('la transferencia declarada GANA sobre el plazo vencido', () => {
    // La plata pudo salir en fecha; lo que falta es que la dueña verifique. Sin
    // esta precedencia el panel le decía "perdiste la hora" a quien ya pagó.
    expect(displayedBookingStatus(vencida([{
      provider: 'manual',
      status: 'pending',
      providerPaymentId: btDeclaredId('bk-1'),
    }]), NOW))
      .toBe('pending_payment')
  })

  it('un pago de Mercado Pago en vuelo GANA sobre el plazo vencido', () => {
    expect(displayedBookingStatus(vencida([{
      provider: 'mercado_pago',
      status: 'pending',
      providerPaymentId: 'mp-1',
    }]), NOW)).toBe('pending_payment')
  })

  it('un pago de Mercado Pago fallido NO tapa el plazo vencido', () => {
    expect(displayedBookingStatus(vencida([{
      provider: 'mercado_pago',
      status: 'failed',
      providerPaymentId: 'mp-1',
    }]), NOW)).toBe(HOLD_EXPIRED_STATUS)
  })

  it('un pago de OTRA familia no la salva: el prefijo discrimina', () => {
    // bt-balance es el saldo de una reserva ya firme, no el abono de ésta.
    expect(displayedBookingStatus(vencida([{
      provider: 'manual',
      status: 'pending',
      providerPaymentId: btBalanceId('bk-1'),
    }]), NOW))
      .toBe(HOLD_EXPIRED_STATUS)
  })

  it('con el plazo vivo no mira los pagos', () => {
    expect(displayedBookingStatus({ ...vencida([]), holdExpiresAt: VIVO }, NOW)).toBe('pending_payment')
  })
})

describe('bookingStatusLabel', () => {
  it('sabe nombrar el estado derivado', () => {
    // El lookup cae al status crudo si no encuentra la clave, así que olvidarla
    // no rompe nada: imprime "hold_expired" en la pantalla de la dueña.
    expect(bookingStatusLabel(HOLD_EXPIRED_STATUS)).toBe(HOLD_EXPIRED_LABEL)
  })

  it('sigue cayendo al crudo con un status desconocido', () => {
    expect(bookingStatusLabel('marciano')).toBe('marciano')
  })
})
