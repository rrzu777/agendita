import { describe, it, expect } from 'vitest'
import { deriveBalanceState } from '@/lib/payments/balance-confirmation-state'

describe('deriveBalanceState proof', () => {
  it('verifying con proofKey marca hasProof', () => {
    const s = deriveBalanceState({
      status: 'confirmed', remainingBalance: 5000,
      payments: [{ status: 'pending', providerPaymentId: 'bt-balance:b1', amount: 5000, proofKey: 'proofs/x/b1/balance' }],
    } as never)
    expect(s.verifying).toBe(true)
    expect(s.payment?.hasProof).toBe(true)
  })
  it('verifying sin proofKey → hasProof false', () => {
    const s = deriveBalanceState({
      status: 'confirmed', remainingBalance: 5000,
      payments: [{ status: 'pending', providerPaymentId: 'bt-balance:b1', amount: 5000, proofKey: null }],
    } as never)
    expect(s.payment?.hasProof).toBe(false)
  })
})
