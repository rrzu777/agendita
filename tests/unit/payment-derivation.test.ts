import { describe, it, expect } from 'vitest'
import { deriveManualPaymentType } from '@/lib/payments/derive-payment-type'
import { deriveConfirmationState } from '@/lib/payments/confirmation-state'

describe('deriveManualPaymentType', () => {
  describe('no prior deposit (depositPaid === 0)', () => {
    it('returns deposit when amount < remainingBalance', () => {
      const booking = { depositPaid: 0, remainingBalance: 20000 }
      expect(deriveManualPaymentType(booking, 10000)).toBe('deposit')
      expect(deriveManualPaymentType(booking, 5000)).toBe('deposit')
      expect(deriveManualPaymentType(booking, 1)).toBe('deposit')
    })

    it('returns full_payment when amount >= remainingBalance', () => {
      const booking = { depositPaid: 0, remainingBalance: 20000 }
      expect(deriveManualPaymentType(booking, 20000)).toBe('full_payment')
      expect(deriveManualPaymentType(booking, 25000)).toBe('full_payment')
      expect(deriveManualPaymentType(booking, 50000)).toBe('full_payment')
    })

    it('returns full_payment when amount == remainingBalance', () => {
      const booking = { depositPaid: 0, remainingBalance: 15000 }
      expect(deriveManualPaymentType(booking, 15000)).toBe('full_payment')
    })
  })

  describe('with prior deposit (depositPaid > 0)', () => {
    it('returns final_payment regardless of amount', () => {
      const booking = { depositPaid: 10000, remainingBalance: 10000 }
      expect(deriveManualPaymentType(booking, 10000)).toBe('final_payment')
      expect(deriveManualPaymentType(booking, 5000)).toBe('final_payment')
      expect(deriveManualPaymentType(booking, 15000)).toBe('final_payment')
    })

    it('returns final_payment when amount covers remainingBalance exactly', () => {
      const booking = { depositPaid: 5000, remainingBalance: 15000 }
      expect(deriveManualPaymentType(booking, 15000)).toBe('final_payment')
    })

    it('returns final_payment when amount > remainingBalance', () => {
      const booking = { depositPaid: 5000, remainingBalance: 10000 }
      expect(deriveManualPaymentType(booking, 15000)).toBe('final_payment')
    })
  })

  describe('edge cases', () => {
    it('handles zero remainingBalance', () => {
      const booking = { depositPaid: 20000, remainingBalance: 0 }
      expect(deriveManualPaymentType(booking, 5000)).toBe('final_payment')
    })

    it('handles zero amount (edge — not valid payment but should not throw)', () => {
      const booking = { depositPaid: 0, remainingBalance: 20000 }
      expect(deriveManualPaymentType(booking, 0)).toBe('deposit')
    })

    it('handles very large amounts', () => {
      const booking = { depositPaid: 0, remainingBalance: 1000000 }
      expect(deriveManualPaymentType(booking, 1000000)).toBe('full_payment')
      expect(deriveManualPaymentType(booking, 999999)).toBe('deposit')
    })
  })
})

describe('deriveConfirmationState with manual payments', () => {
  // Reserva que todavía debe el abono: los montos son parte de la entrada desde que
  // un pago aprobado dejó de alcanzar para dar la reserva por confirmada.
  const debiendo = { depositRequired: 5000, depositPaid: 0, paymentStatus: 'unpaid', holdExpiresAt: null }

  it('returns confirmed for confirmed status regardless of payments', () => {
    expect(deriveConfirmationState({ ...debiendo, status: 'confirmed', payments: [] })).toBe('confirmed')
    expect(
      deriveConfirmationState({
        ...debiendo,
        status: 'confirmed',
        payments: [{ status: 'pending', provider: 'manual' as const }],
      })
    ).toBe('confirmed')
  })

  it('returns pending when only manual payments exist on pending_payment', () => {
    expect(
      deriveConfirmationState({
        ...debiendo,
        status: 'pending_payment',
        payments: [{ status: 'approved', provider: 'manual' as const }],
      })
    ).toBe('pending')
  })

  it('completed status is confirmed', () => {
    expect(deriveConfirmationState({ ...debiendo, status: 'completed', payments: [] })).toBe('confirmed')
  })
})