import { describe, it, expect } from 'vitest'
import { isManualPaymentAllowed, manualPaymentBlockedReason } from '@/components/dashboard/manual-payment-utils'

const NOW = new Date('2026-08-03T12:00:00Z')
const VIVO = new Date('2026-08-03T18:00:00Z')
const MUERTO = new Date('2026-08-03T09:00:00Z')

/** `unpaid` por default: es el caso que el cron barre, o sea el único en el que
 *  el plazo vencido cierra el cobro. Los casos con plata adentro lo pisan. */
function reserva(fields: {
  status: string
  remainingBalance: number
  holdExpiresAt: Date | null
  paymentStatus?: string
}) {
  return { paymentStatus: 'unpaid', ...fields }
}

describe('isManualPaymentAllowed', () => {
  it('permite pending_payment y confirmed con saldo (comportamiento actual)', () => {
    expect(isManualPaymentAllowed(reserva({ status: 'pending_payment', remainingBalance: 8000, holdExpiresAt: VIVO }), NOW)).toBe(true)
    expect(isManualPaymentAllowed(reserva({ status: 'confirmed', remainingBalance: 8000, holdExpiresAt: null }), NOW)).toBe(true)
  })

  it('permite completed con saldo (recobro post-chargeback)', () => {
    expect(isManualPaymentAllowed(reserva({ status: 'completed', remainingBalance: 8000, holdExpiresAt: null }), NOW)).toBe(true)
  })

  it('sigue rechazando completed sin saldo y estados muertos', () => {
    expect(isManualPaymentAllowed(reserva({ status: 'completed', remainingBalance: 0, holdExpiresAt: null }), NOW)).toBe(false)
    expect(isManualPaymentAllowed(reserva({ status: 'cancelled', remainingBalance: 8000, holdExpiresAt: null }), NOW)).toBe(false)
    expect(isManualPaymentAllowed(reserva({ status: 'expired', remainingBalance: 8000, holdExpiresAt: null }), NOW)).toBe(false)
    expect(isManualPaymentAllowed(reserva({ status: 'no_show', remainingBalance: 8000, holdExpiresAt: null }), NOW)).toBe(false)
  })

  it('con el plazo vencido y nada pagado no ofrece cobrar: el server lo rechaza', () => {
    expect(isManualPaymentAllowed(reserva({ status: 'pending_payment', remainingBalance: 8000, holdExpiresAt: MUERTO }), NOW)).toBe(false)
  })

  it('el plazo vencido sólo pesa en pending_payment', () => {
    // Espejo del guard del server: una confirmada ya no depende del hold —
    // puede tener uno viejo escrito y el cobro sigue siendo legítimo.
    expect(isManualPaymentAllowed(reserva({ status: 'confirmed', remainingBalance: 8000, holdExpiresAt: MUERTO }), NOW)).toBe(true)
    expect(isManualPaymentAllowed(reserva({ status: 'completed', remainingBalance: 8000, holdExpiresAt: MUERTO }), NOW)).toBe(true)
  })

  // El caso que era un callejón sin salida: el pago llegó tarde y el horario ya
  // se lo había llevado otra persona, así que la reserva quedó pending_payment
  // con plata adentro. El cron NO la barre (filtra `unpaid`), así que el plazo
  // vencido no la condena a nada — cerrarle el cobro dejaba a la clienta con el
  // efectivo en la mano y a la dueña sin dónde asentarlo.
  it.each(['deposit_paid', 'fully_paid', 'refunded', 'failed'])(
    'con plazo vencido pero paymentStatus %s SÍ ofrece cobrar: el cron nunca la va a expirar',
    (paymentStatus) => {
      expect(isManualPaymentAllowed(reserva({ status: 'pending_payment', remainingBalance: 8000, holdExpiresAt: MUERTO, paymentStatus }), NOW)).toBe(true)
    },
  )
})

describe('manualPaymentBlockedReason', () => {
  it('explica el plazo vencido y nombra la salida', () => {
    // Sin esto, el botón que desaparece es indistinguible de una app rota. La
    // salida (esperar al cron y usar Revivir) no está a la vista en ningún lado.
    const reason = manualPaymentBlockedReason(reserva({ status: 'pending_payment', remainingBalance: 8000, holdExpiresAt: MUERTO }), NOW)
    expect(reason).toContain('Revivir')
  })

  it('no manda a esperar un Expirada que no va a llegar', () => {
    // El texto promete "esperá a que quede Expirada y usá Revivir". Sobre una
    // reserva con plata adentro esa espera es infinita — el cron la saltea. Acá
    // no hay motivo que dar porque no hay bloqueo: se cobra y listo.
    expect(manualPaymentBlockedReason(reserva({ status: 'pending_payment', remainingBalance: 8000, holdExpiresAt: MUERTO, paymentStatus: 'deposit_paid' }), NOW)).toBeNull()
  })

  it('calla cuando sí se puede cobrar', () => {
    expect(manualPaymentBlockedReason(reserva({ status: 'pending_payment', remainingBalance: 8000, holdExpiresAt: VIVO }), NOW)).toBeNull()
    expect(manualPaymentBlockedReason(reserva({ status: 'confirmed', remainingBalance: 8000, holdExpiresAt: MUERTO }), NOW)).toBeNull()
  })

  it('calla cuando el motivo se ve solo en la fila', () => {
    // Saldo cero y reserva muerta no necesitan explicación: la fila ya la da.
    expect(manualPaymentBlockedReason(reserva({ status: 'pending_payment', remainingBalance: 0, holdExpiresAt: MUERTO }), NOW)).toBeNull()
    expect(manualPaymentBlockedReason(reserva({ status: 'cancelled', remainingBalance: 8000, holdExpiresAt: MUERTO }), NOW)).toBeNull()
  })

  it('nunca hay motivo escrito sin botón deshabilitado, ni al revés', () => {
    // El invariante que hace que la UI no mienta: si se explica, es porque no se
    // puede; y todo bloqueo que merece explicación la tiene.
    const casos = [
      reserva({ status: 'pending_payment', remainingBalance: 8000, holdExpiresAt: MUERTO }),
      reserva({ status: 'pending_payment', remainingBalance: 8000, holdExpiresAt: MUERTO, paymentStatus: 'deposit_paid' }),
      reserva({ status: 'pending_payment', remainingBalance: 8000, holdExpiresAt: VIVO }),
      reserva({ status: 'confirmed', remainingBalance: 8000, holdExpiresAt: MUERTO }),
      reserva({ status: 'completed', remainingBalance: 0, holdExpiresAt: null }),
    ]
    for (const c of casos) {
      if (manualPaymentBlockedReason(c, NOW) != null) expect(isManualPaymentAllowed(c, NOW)).toBe(false)
    }
  })
})
