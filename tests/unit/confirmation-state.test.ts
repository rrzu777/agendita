import { describe, it, expect } from 'vitest'
import { deriveConfirmationState } from '@/lib/payments/confirmation-state'

describe('deriveConfirmationState', () => {
  function mp(status: string) {
    return { status, provider: 'mercado_pago' as const }
  }

  /** Reserva sin plata adentro: con ese default los casos de abajo hablan solo de
   *  los pagos. Los montos importan en el bloque de `paid_unconfirmed`, y ahí van
   *  explícitos. */
  function booking(over: {
    status: string
    payments: { status: string; provider: string; providerPaymentId?: string | null }[]
    depositRequired?: number
    depositPaid?: number
    paymentStatus?: string
    holdExpiresAt?: Date | null
    approvalExpiresAt?: Date | null
  }) {
    return {
      depositRequired: 5000,
      depositPaid: 0,
      paymentStatus: 'unpaid',
      holdExpiresAt: null,
      approvalExpiresAt: null,
      ...over,
    }
  }

  it('returns confirmed when booking status is confirmed', () => {
    expect(deriveConfirmationState(booking({ status: 'confirmed', payments: [] }))).toBe('confirmed')
  })

  it('returns confirmed when booking status is completed', () => {
    expect(deriveConfirmationState(booking({ status: 'completed', payments: [] }))).toBe('confirmed')
  })

  it('returns verifying when MP payment is pending', () => {
    expect(deriveConfirmationState(booking({ status: 'pending_payment', payments: [mp('pending')] }))).toBe('verifying')
  })

  it('returns verifying when MP payment is in_process', () => {
    expect(deriveConfirmationState(booking({ status: 'pending_payment', payments: [mp('in_process')] }))).toBe('verifying')
  })

  it('returns rejected when MP payment is rejected', () => {
    expect(deriveConfirmationState(booking({ status: 'pending_payment', payments: [mp('rejected')] }))).toBe('rejected')
  })

  it('returns rejected when MP payment is cancelled', () => {
    expect(deriveConfirmationState(booking({ status: 'pending_payment', payments: [mp('cancelled')] }))).toBe('rejected')
  })

  it('returns rejected when MP payment is failed', () => {
    expect(deriveConfirmationState(booking({ status: 'pending_payment', payments: [mp('failed')] }))).toBe('rejected')
  })

  it('returns pending when no MP payments exist', () => {
    expect(deriveConfirmationState(booking({ status: 'pending_payment', payments: [] }))).toBe('pending')
  })

  it('returns pending when only non-MP payments exist', () => {
    expect(
      deriveConfirmationState(
        booking({ status: 'pending_payment', payments: [{ status: 'approved', provider: 'manual' }] }),
      ),
    ).toBe('pending')
  })

  it('returns verifying when there is a rejected old payment and a new pending one', () => {
    expect(
      deriveConfirmationState(booking({ status: 'pending_payment', payments: [mp('rejected'), mp('pending')] })),
    ).toBe('verifying')
  })

  describe('un pago aprobado no confirma nada por su cuenta', () => {
    // El corazón del fix. Antes bastaba un Payment aprobado para mostrar "Reserva
    // confirmada — te esperamos el {día} a las {hora}", sin mirar la reserva. Desde que
    // el flip a `confirmed` puede no ocurrir (el horario ya tomado: el `slotConflict` de
    // recalcBookingFromPayments), esa inferencia le prometía la hora a alguien que no la
    // tenía. Y esta pantalla es la URL de retorno de Mercado Pago.
    it('el abono entró pero la reserva sigue pending_payment → paid_unconfirmed', () => {
      expect(
        deriveConfirmationState(
          booking({
            status: 'pending_payment',
            depositRequired: 5000,
            depositPaid: 5000,
            paymentStatus: 'deposit_paid',
            payments: [mp('approved')],
          }),
        ),
      ).toBe('paid_unconfirmed')
    })

    it('con el status ya en confirmed sigue siendo confirmed (sin regresión)', () => {
      expect(
        deriveConfirmationState(
          booking({
            status: 'confirmed',
            depositPaid: 5000,
            paymentStatus: 'deposit_paid',
            payments: [mp('approved')],
          }),
        ),
      ).toBe('confirmed')
    })

    it('aprobado que NO cubre el abono deja la reserva debiendo → pending', () => {
      expect(
        deriveConfirmationState(
          booking({
            status: 'pending_payment',
            depositRequired: 5000,
            depositPaid: 2000,
            paymentStatus: 'unpaid',
            payments: [mp('approved')],
          }),
        ),
      ).toBe('pending')
    })

    it('rechazado + aprobado que cubre el abono → paid_unconfirmed (no confirmed)', () => {
      expect(
        deriveConfirmationState(
          booking({
            status: 'pending_payment',
            depositPaid: 5000,
            paymentStatus: 'deposit_paid',
            payments: [mp('rejected'), mp('approved')],
          }),
        ),
      ).toBe('paid_unconfirmed')
    })

    it('transferencia YA verificada por la dueña y horario perdido → paid_unconfirmed', () => {
      // isDeclaredTransferPayment exige `pending`: una vez verificada deja de matchear,
      // y sin el corte por montos esto caía en "pendiente de pago" pidiéndole a la
      // clienta que transfiriera de nuevo una plata que el negocio ya tenía.
      expect(
        deriveConfirmationState(
          booking({
            status: 'pending_payment',
            depositPaid: 5000,
            paymentStatus: 'deposit_paid',
            payments: [{ status: 'approved', provider: 'manual', providerPaymentId: 'bt-declared:abc' }],
          }),
        ),
      ).toBe('paid_unconfirmed')
    })

    it('una reversión (refunded) no muestra "recibimos tu pago"', () => {
      expect(
        deriveConfirmationState(
          booking({
            status: 'pending_payment',
            depositPaid: 5000,
            paymentStatus: 'refunded',
            payments: [mp('approved')],
          }),
        ),
      ).toBe('pending')
    })

    it('sin plata adentro no hay paid_unconfirmed aunque el abono sea 0', () => {
      // Una reserva con depositRequired 0 queda en `deposit_paid` sin haber pagado
      // nada: el `depositPaid > 0` es lo que evita anunciarle un pago inexistente.
      expect(
        deriveConfirmationState(
          booking({
            status: 'pending_payment',
            depositRequired: 0,
            depositPaid: 0,
            paymentStatus: 'deposit_paid',
            payments: [],
          }),
        ),
      ).toBe('pending')
    })

    it('una solicitud por confirmar con plata adentro no le echa la culpa al horario', () => {
      // Hoy `pending_confirmation` no es pagable (MANUAL_PAYMENT_STATUSES), así que esta
      // fila no debería existir. El corte por status es lo que evita que, si algún día
      // existe, la pantalla afirme un motivo que no le consta.
      expect(
        deriveConfirmationState(
          booking({
            status: 'pending_confirmation',
            depositPaid: 5000,
            paymentStatus: 'deposit_paid',
            payments: [mp('approved')],
          }),
        ),
      ).toBe('pending')
    })

    it('los estados terminales siguen cortando primero, con plata adentro', () => {
      for (const status of ['expired', 'cancelled'] as const) {
        expect(
          deriveConfirmationState(
            booking({ status, depositPaid: 5000, paymentStatus: 'deposit_paid', payments: [mp('approved')] }),
          ),
        ).toBe(status)
      }
    })
  })

  describe('transferencia bancaria y estados terminales', () => {
    const bt = (status: string) => ({ status, provider: 'manual', providerPaymentId: 'bt-declared:abc' })

    it('expired corta primero aunque haya payment pendiente', () => {
      expect(deriveConfirmationState(booking({ status: 'expired', payments: [bt('pending')] }))).toBe('expired')
    })

    it('cancelled corta primero aunque haya payment rejected', () => {
      expect(deriveConfirmationState(booking({ status: 'cancelled', payments: [bt('rejected')] }))).toBe('cancelled')
    })

    it('bt pending → verifying_transfer', () => {
      expect(deriveConfirmationState(booking({ status: 'pending_payment', payments: [bt('pending')] }))).toBe('verifying_transfer')
    })

    it('manual de la dueña (sin bt-declared) NO dispara verifying_transfer', () => {
      expect(
        deriveConfirmationState(
          booking({
            status: 'pending_payment',
            payments: [{ status: 'pending', provider: 'manual', providerPaymentId: null }],
          }),
        ),
      ).toBe('pending')
    })

    it('MP pending sigue siendo verifying (sin regresión)', () => {
      expect(
        deriveConfirmationState(
          booking({
            status: 'pending_payment',
            payments: [{ status: 'pending', provider: 'mercado_pago', providerPaymentId: null }],
          }),
        ),
      ).toBe('verifying')
    })
  })

  describe('hold vencido que el cron todavía no barrió', () => {
    // La pantalla es la URL de retorno de MP: entre que el hold vence y el cron
    // pasa (hasta una hora), "completá el pago" mandaba a pagar un horario que ya
    // se estaba liberando. El adelanto espeja las condiciones EXACTAS del barrido
    // (pending_payment + unpaid + hold < now): lo que el cron no va a expirar,
    // esto tampoco lo da por muerto.
    const now = new Date('2026-08-03T15:00:00Z')
    const vencido = new Date('2026-08-03T14:30:00Z')
    const vivo = new Date('2026-08-03T15:10:00Z')
    const bt = (status: string) => ({ status, provider: 'manual', providerPaymentId: 'bt-declared:abc' })

    it('pending con hold vencido → expired (sin pagos)', () => {
      expect(
        deriveConfirmationState(booking({ status: 'pending_payment', payments: [], holdExpiresAt: vencido }), now),
      ).toBe('expired')
    })

    it('rejected con hold vencido → expired ("intentá de nuevo" ya no es cierto)', () => {
      expect(
        deriveConfirmationState(
          booking({ status: 'pending_payment', payments: [mp('rejected')], holdExpiresAt: vencido }),
          now,
        ),
      ).toBe('expired')
    })

    it('con el hold vivo no cambia nada', () => {
      expect(
        deriveConfirmationState(booking({ status: 'pending_payment', payments: [], holdExpiresAt: vivo }), now),
      ).toBe('pending')
      expect(
        deriveConfirmationState(
          booking({ status: 'pending_payment', payments: [mp('rejected')], holdExpiresAt: vivo }),
          now,
        ),
      ).toBe('rejected')
    })

    it('un pago en vuelo gana: verifying aunque el hold haya vencido', () => {
      // El pago puede aterrizar y confirmar después del vencimiento; esa carrera
      // la arbitra el guard de solape del webhook, no esta pantalla.
      expect(
        deriveConfirmationState(
          booking({ status: 'pending_payment', payments: [mp('in_process')], holdExpiresAt: vencido }),
          now,
        ),
      ).toBe('verifying')
    })

    it('la transferencia declarada no se da por muerta', () => {
      expect(
        deriveConfirmationState(
          booking({ status: 'pending_payment', payments: [bt('pending')], holdExpiresAt: vencido }),
          now,
        ),
      ).toBe('verifying_transfer')
    })

    it('plata parcial adentro (no unpaid) no se adelanta: el cron tampoco la barre', () => {
      expect(
        deriveConfirmationState(
          booking({
            status: 'pending_payment',
            depositRequired: 5000,
            depositPaid: 2000,
            paymentStatus: 'deposit_paid',
            payments: [mp('approved')],
            holdExpiresAt: vencido,
          }),
          now,
        ),
      ).toBe('pending')
    })

    // La solicitud sin responder también muere sola (`expireUnansweredRequests`),
    // y ese sweep NO filtra por pago: una solicitud gratis nace `fully_paid`.
    it('una solicitud por confirmar con el plazo de aprobación vencido también está condenada', () => {
      expect(
        deriveConfirmationState(
          booking({ status: 'pending_confirmation', payments: [], approvalExpiresAt: vencido, paymentStatus: 'fully_paid' }),
          now,
        ),
      ).toBe('expired')
    })

    it('la solicitud con el plazo de aprobación vivo sigue esperando respuesta', () => {
      expect(
        deriveConfirmationState(
          booking({ status: 'pending_confirmation', payments: [], approvalExpiresAt: vivo }),
          now,
        ),
      ).toBe('pending')
    })

    it('cada status ignora la columna del otro plazo', () => {
      expect(
        deriveConfirmationState(
          booking({ status: 'pending_confirmation', payments: [], holdExpiresAt: vencido }),
          now,
        ),
      ).toBe('pending')
      expect(
        deriveConfirmationState(
          booking({ status: 'pending_payment', payments: [], approvalExpiresAt: vencido }),
          now,
        ),
      ).toBe('pending')
    })

    it('con holdExpiresAt null (reserva sin hold) se comporta como siempre', () => {
      expect(
        deriveConfirmationState(booking({ status: 'pending_payment', payments: [], holdExpiresAt: null }), now),
      ).toBe('pending')
    })
  })
})
