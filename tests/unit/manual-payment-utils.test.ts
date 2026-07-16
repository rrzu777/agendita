import { describe, it, expect } from 'vitest'
import { isManualPaymentAllowed } from '@/components/dashboard/manual-payment-utils'

describe('isManualPaymentAllowed', () => {
  it('permite pending_payment y confirmed con saldo (comportamiento actual)', () => {
    expect(isManualPaymentAllowed({ status: 'pending_payment', remainingBalance: 8000 })).toBe(true)
    expect(isManualPaymentAllowed({ status: 'confirmed', remainingBalance: 8000 })).toBe(true)
  })

  it('permite completed con saldo (recobro post-chargeback)', () => {
    expect(isManualPaymentAllowed({ status: 'completed', remainingBalance: 8000 })).toBe(true)
  })

  it('sigue rechazando completed sin saldo y estados muertos', () => {
    expect(isManualPaymentAllowed({ status: 'completed', remainingBalance: 0 })).toBe(false)
    expect(isManualPaymentAllowed({ status: 'cancelled', remainingBalance: 8000 })).toBe(false)
    expect(isManualPaymentAllowed({ status: 'expired', remainingBalance: 8000 })).toBe(false)
    expect(isManualPaymentAllowed({ status: 'no_show', remainingBalance: 8000 })).toBe(false)
  })
})
