import { describe, expect, it } from 'vitest'
import {
  calculateManualPaymentAmount,
  getManualPaymentSuggestion,
} from '@/components/dashboard/manual-payment-utils'

describe('manual payment form helpers', () => {
  it('calculates percentage amounts from the pending balance', () => {
    expect(calculateManualPaymentAmount({
      mode: 'percentage',
      value: 25,
      remainingBalance: 12000,
    })).toBe(3000)
  })

  it('caps configured deposit suggestions at the pending balance for bookings without payments', () => {
    expect(getManualPaymentSuggestion({
      depositPaid: 0,
      depositRequired: 15000,
      remainingBalance: 10000,
    })).toEqual({
      amount: 10000,
      label: 'Abono configurado',
    })
  })

  it('suggests the full pending balance when the booking already has payments', () => {
    expect(getManualPaymentSuggestion({
      depositPaid: 5000,
      depositRequired: 10000,
      remainingBalance: 15000,
    })).toEqual({
      amount: 15000,
      label: 'Saldo pendiente',
    })
  })
})
