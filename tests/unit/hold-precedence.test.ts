import { describe, expect, it } from 'vitest'
import { anyDeclaredTransferWhere, btDeclaredId } from '@/lib/bank-transfer/declared'
import {
  hasPaymentThatOverridesExpiredHold,
  hasPendingMercadoPagoPayment,
  holdPrecedencePaymentWhere,
} from '@/lib/payments/hold-precedence'

describe('precedencia de pagos sobre el hold vencido', () => {
  it('la consulta compartida trae transferencias declaradas y Mercado Pago pendiente', () => {
    expect(holdPrecedencePaymentWhere.OR).toEqual([
      anyDeclaredTransferWhere,
      { provider: 'mercado_pago', status: 'pending' },
    ])
  })

  it('reconoce únicamente un Payment pendiente de Mercado Pago', () => {
    const pending = {
      status: 'pending_payment',
      payments: [{ provider: 'mercado_pago', status: 'pending' }],
    }
    expect(hasPendingMercadoPagoPayment(pending)).toBe(true)
    expect(hasPendingMercadoPagoPayment({
      ...pending,
      payments: [{ provider: 'mercado_pago', status: 'failed' }],
    })).toBe(false)
    expect(hasPendingMercadoPagoPayment({
      payments: [{ provider: 'manual', status: 'pending' }],
    })).toBe(false)
  })

  it('aplica la misma precedencia a transferencia declarada y MP en vuelo', () => {
    expect(hasPaymentThatOverridesExpiredHold({
      status: 'pending_payment',
      payments: [{
        provider: 'manual',
        status: 'pending',
        providerPaymentId: btDeclaredId('bk-1'),
      }],
    })).toBe(true)
    expect(hasPaymentThatOverridesExpiredHold({
      status: 'pending_payment',
      payments: [{ provider: 'mercado_pago', status: 'pending' }],
    })).toBe(true)
  })
})
