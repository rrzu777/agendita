import { describe, expect, it } from 'vitest'
import { rescheduleBlockedReason } from '@/lib/bookings/hold'

const AHORA = new Date('2026-08-04T12:00:00Z')
const vencido = new Date(AHORA.getTime() - 60_000)
const vivo = new Date(AHORA.getTime() + 60 * 60_000)

function reserva(over: Partial<{
  status: string
  paymentStatus: string
  holdExpiresAt: Date | null
  approvalExpiresAt: Date | null
}> = {}) {
  const status = over.status ?? 'pending_payment'
  return {
    status,
    paymentStatus: 'unpaid',
    holdExpiresAt: status === 'pending_payment' ? vencido : null,
    approvalExpiresAt: status === 'pending_confirmation' ? vencido : null,
    ...over,
  }
}

describe('rescheduleBlockedReason', () => {
  // Espeja al cron, no a "el plazo pasó": con plata adentro el sweep no pasa
  // nunca, así que ahí el plazo vencido no condena a nada.
  describe('cuándo bloquea', () => {
    it('sin plazo, o con el plazo vivo, no bloquea', () => {
      expect(rescheduleBlockedReason(reserva({ holdExpiresAt: null }), 'owner', AHORA)).toBeNull()
      expect(rescheduleBlockedReason(reserva({ holdExpiresAt: vivo }), 'owner', AHORA)).toBeNull()
    })

    it('con plata adentro no bloquea aunque el plazo haya vencido', () => {
      expect(rescheduleBlockedReason(reserva({ paymentStatus: 'deposit_paid' }), 'owner', AHORA)).toBeNull()
    })

    it('bloquea la reserva sin pagar y la solicitud sin responder, que son las dos que barre el cron', () => {
      expect(rescheduleBlockedReason(reserva(), 'owner', AHORA)).not.toBeNull()
      expect(
        rescheduleBlockedReason(
          reserva({ status: 'pending_confirmation', paymentStatus: 'fully_paid' }),
          'owner',
          AHORA,
        ),
      ).not.toBeNull()
    })

    it('una reserva confirmada nunca se bloquea por esto', () => {
      expect(rescheduleBlockedReason(reserva({ status: 'confirmed' }), 'owner', AHORA)).toBeNull()
    })
  })

  // Los cuatro textos existen porque las dos preguntas que contesta un "no"
  // —qué venció y qué hago ahora— tienen respuestas distintas de cada lado.
  describe('qué salida nombra', () => {
    it('a la dueña, sobre una reserva sin pagar, le nombra Revivir', () => {
      const msg = rescheduleBlockedReason(reserva(), 'owner', AHORA)
      expect(msg).toContain('Revivir')
      expect(msg).toContain('verificá la transferencia')
    })

    // Aceptar limpia el plazo, así que la solicitud está a un clic de salvarse:
    // mandarla a esperar el Revivir sería nombrarle una salida que ni aparece.
    it('a la dueña, sobre una solicitud sin responder, le nombra Aceptar', () => {
      const msg = rescheduleBlockedReason(
        reserva({ status: 'pending_confirmation', paymentStatus: 'fully_paid' }),
        'owner',
        AHORA,
      )
      expect(msg?.toLowerCase()).toContain('aceptala')
      expect(msg).not.toContain('Revivir')
    })

    // El cron barre TAMBIÉN la transferencia ya declarada, así que este texto le
    // puede caer a alguien que transfirió en fecha y que en la misma pantalla lee
    // "Transferencia en verificación". El bloqueo es correcto; la acusación no.
    it('a la clienta nunca le dice que no pagó, ni le nombra botones del panel', () => {
      for (const status of ['pending_payment', 'pending_confirmation']) {
        const msg = rescheduleBlockedReason(reserva({ status }), 'customer', AHORA)
        expect(msg).not.toContain('para pagar')
        expect(msg).not.toContain('Revivir')
        expect(msg).toContain('Contactá al negocio')
      }
    })

    it('a la clienta, la solicitud vencida la explica por quien tenía que responder', () => {
      expect(
        rescheduleBlockedReason(reserva({ status: 'pending_confirmation' }), 'customer', AHORA),
      ).toContain('El negocio no respondió esta solicitud a tiempo')
    })

    // `isDoomedBooking` sólo condena esos dos status, pero si mañana suma uno, el
    // texto genérico sigue siendo cierto y el de la solicitud no lo sería.
    it('un status inesperado caería en el texto genérico, no en el de la solicitud', () => {
      // (Hoy no llega ninguno: se fuerza el mensaje con un hold vencido y un
      // status que el predicado no condena sería `null`, así que esto documenta
      // la rama del ternario, no un caso alcanzable.)
      const solicitud = rescheduleBlockedReason(reserva({ status: 'pending_confirmation' }), 'owner', AHORA)
      const pago = rescheduleBlockedReason(reserva(), 'owner', AHORA)
      expect(solicitud).not.toBe(pago)
    })
  })

  // El `now` es obligatorio: la etiqueta de estado y este bloqueo salen del
  // mismo instante, y con default el servidor y el navegador decidirían distinto.
  it('con un reloj anterior al vencimiento, no bloquea', () => {
    const antes = new Date(vencido.getTime() - 60_000)
    expect(rescheduleBlockedReason(reserva(), 'owner', antes)).toBeNull()
  })
})
