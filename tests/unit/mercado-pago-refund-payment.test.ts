import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createMercadoPagoProvider } from '@/lib/payments/mercado-pago-provider'

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

describe('MP refundPayment', () => {
  beforeEach(() => fetchMock.mockReset())

  it('POST /refunds con amount, Authorization del negocio y X-Idempotency-Key', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: () => Promise.resolve({ id: 999, status: 'approved' }) })
    const provider = createMercadoPagoProvider('token-del-negocio')
    const r = await provider.refundPayment({
      providerPaymentId: 'mp-123', amount: 30000, currency: 'CLP', idempotencyKey: 'refund:pkg:p1',
    })
    expect(r.refundId).toBe('999')
    expect(r.status).toBe('refunded')
    const [url, opts] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.mercadopago.com/v1/payments/mp-123/refunds')
    expect(opts.method).toBe('POST')
    expect(JSON.parse(opts.body)).toEqual({ amount: 30000 })
    expect(opts.headers['Authorization']).toBe('Bearer token-del-negocio')
    expect(opts.headers['X-Idempotency-Key']).toBe('refund:pkg:p1')
  })

  it('propaga error si MP responde no-ok', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 400, text: () => Promise.resolve('bad') })
    const provider = createMercadoPagoProvider('t')
    await expect(provider.refundPayment({
      providerPaymentId: 'mp-1', amount: 1, currency: 'CLP', idempotencyKey: 'k',
    })).rejects.toThrow(/Mercado Pago API error 400/)
  })
})
