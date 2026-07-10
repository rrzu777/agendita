import { describe, it, expect } from 'vitest'
import { deriveConfirmationState } from '@/lib/payments/confirmation-state'

describe('deriveConfirmationState', () => {
  function mp(status: string) {
    return { status, provider: 'mercado_pago' as const }
  }

  it('returns confirmed when booking status is confirmed', () => {
    expect(
      deriveConfirmationState({ status: 'confirmed', payments: [] }),
    ).toBe('confirmed')
  })

  it('returns confirmed when booking status is completed', () => {
    expect(
      deriveConfirmationState({ status: 'completed', payments: [] }),
    ).toBe('confirmed')
  })

  it('returns confirmed when an MP payment is approved', () => {
    expect(
      deriveConfirmationState({
        status: 'pending_payment',
        payments: [mp('approved')],
      }),
    ).toBe('confirmed')
  })

  it('returns verifying when MP payment is pending', () => {
    expect(
      deriveConfirmationState({
        status: 'pending_payment',
        payments: [mp('pending')],
      }),
    ).toBe('verifying')
  })

  it('returns verifying when MP payment is in_process', () => {
    expect(
      deriveConfirmationState({
        status: 'pending_payment',
        payments: [mp('in_process')],
      }),
    ).toBe('verifying')
  })

  it('returns rejected when MP payment is rejected', () => {
    expect(
      deriveConfirmationState({
        status: 'pending_payment',
        payments: [mp('rejected')],
      }),
    ).toBe('rejected')
  })

  it('returns rejected when MP payment is cancelled', () => {
    expect(
      deriveConfirmationState({
        status: 'pending_payment',
        payments: [mp('cancelled')],
      }),
    ).toBe('rejected')
  })

  it('returns rejected when MP payment is failed', () => {
    expect(
      deriveConfirmationState({
        status: 'pending_payment',
        payments: [mp('failed')],
      }),
    ).toBe('rejected')
  })

  it('returns pending when no MP payments exist', () => {
    expect(
      deriveConfirmationState({ status: 'pending_payment', payments: [] }),
    ).toBe('pending')
  })

  it('returns pending when only non-MP payments exist', () => {
    expect(
      deriveConfirmationState({
        status: 'pending_payment',
        payments: [{ status: 'approved', provider: 'manual' }],
      }),
    ).toBe('pending')
  })

  it('returns verifying when there is a rejected old payment and a new pending one', () => {
    expect(
      deriveConfirmationState({
        status: 'pending_payment',
        payments: [mp('rejected'), mp('pending')],
      }),
    ).toBe('verifying')
  })

  it('returns confirmed with rejected + approved (approved wins)', () => {
    expect(
      deriveConfirmationState({
        status: 'pending_payment',
        payments: [mp('rejected'), mp('approved')],
      }),
    ).toBe('confirmed')
  })

  describe('transferencia bancaria y estados terminales', () => {
    const bt = (status: string) => ({ status, provider: 'manual', providerPaymentId: 'bt-declared:abc' })

    it('expired corta primero aunque haya payment pendiente', () => {
      expect(deriveConfirmationState({ status: 'expired', payments: [bt('pending')] })).toBe('expired')
    })

    it('cancelled corta primero aunque haya payment rejected', () => {
      expect(deriveConfirmationState({ status: 'cancelled', payments: [bt('rejected')] })).toBe('cancelled')
    })

    it('bt pending → verifying_transfer', () => {
      expect(deriveConfirmationState({ status: 'pending_payment', payments: [bt('pending')] })).toBe('verifying_transfer')
    })

    it('manual de la dueña (sin bt-declared) NO dispara verifying_transfer', () => {
      expect(
        deriveConfirmationState({
          status: 'pending_payment',
          payments: [{ status: 'pending', provider: 'manual', providerPaymentId: null }],
        }),
      ).toBe('pending')
    })

    it('MP pending sigue siendo verifying (sin regresión)', () => {
      expect(
        deriveConfirmationState({
          status: 'pending_payment',
          payments: [{ status: 'pending', provider: 'mercado_pago', providerPaymentId: null }],
        }),
      ).toBe('verifying')
    })
  })
})
