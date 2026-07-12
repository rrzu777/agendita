import { describe, it, expect } from 'vitest'
import { manualPaymentProvider } from '@/lib/payments/manual-provider'
import { mockPaymentProvider } from '@/lib/payments/mock-provider'

describe('refundPayment no-op providers', () => {
  const input = { providerPaymentId: 'x', amount: 1000, currency: 'CLP', idempotencyKey: 'refund:pkg:p1' }
  it('manual devuelve refunded sin refundId', async () => {
    const r = await manualPaymentProvider.refundPayment(input)
    expect(r.status).toBe('refunded')
    expect(r.refundId).toBeNull()
  })
  it('mock devuelve refunded sin refundId', async () => {
    const r = await mockPaymentProvider.refundPayment(input)
    expect(r.status).toBe('refunded')
    expect(r.refundId).toBeNull()
  })
})
