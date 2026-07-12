import { describe, it, expect } from 'vitest'
import { deriveBalanceState } from '@/lib/payments/balance-confirmation-state'

describe('deriveBalanceState', () => {
  it('reserva no firme (pending_payment) → todo false, sin importar saldo/pagos', () => {
    const result = deriveBalanceState({
      status: 'pending_payment',
      remainingBalance: 5000,
      payments: [],
    })
    expect(result).toEqual({
      canDeclare: false,
      verifying: false,
      partial: false,
      rejected: false,
      payment: null,
    })
  })

  it('confirmed sin pago de saldo y con saldo pendiente → puede declarar', () => {
    const result = deriveBalanceState({
      status: 'confirmed',
      remainingBalance: 5000,
      payments: [],
    })
    expect(result.canDeclare).toBe(true)
    expect(result.verifying).toBe(false)
    expect(result.partial).toBe(false)
    expect(result.rejected).toBe(false)
  })

  it('completed con saldo en 0 → no puede declarar', () => {
    const result = deriveBalanceState({
      status: 'completed',
      remainingBalance: 0,
      payments: [],
    })
    expect(result.canDeclare).toBe(false)
    expect(result.verifying).toBe(false)
    expect(result.partial).toBe(false)
    expect(result.rejected).toBe(false)
  })

  it('pago de saldo pending → verificando, no puede volver a declarar', () => {
    const result = deriveBalanceState({
      status: 'confirmed',
      remainingBalance: 5000,
      payments: [{ status: 'pending', providerPaymentId: 'bt-balance:abc', amount: 5000 }],
    })
    expect(result.verifying).toBe(true)
    expect(result.canDeclare).toBe(false)
    expect(result.partial).toBe(false)
    expect(result.rejected).toBe(false)
    expect(result.payment?.amount).toBe(5000)
  })

  it('aprobado con saldo residual (verificación parcial) → partial true, canDeclare false (dead-end)', () => {
    const result = deriveBalanceState({
      status: 'confirmed',
      remainingBalance: 2000,
      payments: [{ status: 'approved', providerPaymentId: 'bt-balance:abc', amount: 3000 }],
    })
    expect(result).toMatchObject({ canDeclare: false, partial: true })
  })

  it('aprobado sin saldo residual → nada que declarar, no es parcial', () => {
    const result = deriveBalanceState({
      status: 'confirmed',
      remainingBalance: 0,
      payments: [{ status: 'approved', providerPaymentId: 'bt-balance:abc', amount: 5000 }],
    })
    expect(result.canDeclare).toBe(false)
    expect(result.partial).toBe(false)
    expect(result.verifying).toBe(false)
  })

  it('rechazado con saldo pendiente → rejected true Y canDeclare true (puede reintentar)', () => {
    const result = deriveBalanceState({
      status: 'confirmed',
      remainingBalance: 5000,
      payments: [{ status: 'rejected', providerPaymentId: 'bt-balance:abc', amount: 5000 }],
    })
    expect(result.rejected).toBe(true)
    expect(result.canDeclare).toBe(true)
  })
})
