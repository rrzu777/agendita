import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

const originalEnv = { ...process.env }

function setEnv(vars: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(vars)) {
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
}

afterEach(() => {
  process.env = { ...originalEnv }
  mockFetch.mockReset()
})

describe('mercadoPagoPaymentProvider', () => {
  let provider: typeof import('@/lib/payments/mercado-pago-provider').mercadoPagoPaymentProvider

  async function getProvider() {
    const mod = await import('@/lib/payments/mercado-pago-provider')
    return mod.mercadoPagoPaymentProvider
  }

  beforeEach(async () => {
    setEnv({ MERCADO_PAGO_ACCESS_TOKEN: 'test-token', NODE_ENV: 'development' })
    vi.resetModules()
    provider = await getProvider()
  })

  describe('createPayment', () => {
    it('creates a preference with metadata, external_reference, notification_url and back_urls', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            id: 'pref-123',
            init_point: 'https://www.mercadopago.cl/checkout/v1/redirect?pref_id=pref-123',
            sandbox_init_point: 'https://sandbox.mercadopago.cl/checkout/v1/redirect?pref_id=pref-123',
          }),
      })

      const result = await provider.createPayment({
        amount: 10000,
        currency: 'CLP',
        bookingId: 'booking-1',
        description: 'Abono para Corte de pelo',
        returnUrl: 'https://example.com/book/confirmation?bookingId=booking-1',
        webhookUrl: 'https://example.com/api/webhooks/mercado-pago',
        localPaymentId: 'pay-local-1',
        customerEmail: 'cliente@example.com',
        metadata: {
          bookingId: 'booking-1',
          businessId: 'biz-1',
          paymentType: 'deposit',
          localPaymentId: 'pay-local-1',
        },
      })

      expect(result.paymentId).toBe('pay-local-1')
      expect(result.providerPaymentId).toBeNull()
      expect(result.redirectUrl).toBe(
        'https://www.mercadopago.cl/checkout/v1/redirect?pref_id=pref-123',
      )
      expect(result.status).toBe('pending')
      expect(result.rawResponse.preferenceId).toBe('pref-123')

      const fetchCall = mockFetch.mock.calls[0] as [string, RequestInit]
      const body = JSON.parse(fetchCall[1].body as string)

      expect(body.external_reference).toBe('pay-local-1')
      expect(body.items[0].unit_price).toBe(10000)
      expect(body.items[0].currency_id).toBe('CLP')
      expect(body.notification_url).toBe('https://example.com/api/webhooks/mercado-pago')
      expect(body.payer.email).toBe('cliente@example.com')
      expect(body.metadata.bookingId).toBe('booking-1')
      expect(body.metadata.businessId).toBe('biz-1')
      expect(body.metadata.paymentType).toBe('deposit')
      expect(body.back_urls.success).toContain('/book/confirmation')
      expect(body.back_urls.failure).toContain('/book/confirmation')
      expect(body.back_urls.pending).toContain('/book/confirmation')
    })

    it('returns redirectUrl from init_point', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            id: 'pref-456',
            init_point: 'https://www.mercadopago.cl/redirect?pref_id=pref-456',
            sandbox_init_point: 'https://sandbox.mercadopago.cl/redirect?pref_id=pref-456',
          }),
      })

      const result = await provider.createPayment({
        amount: 5000,
        currency: 'CLP',
        bookingId: 'booking-2',
        description: 'Test',
        returnUrl: 'https://example.com/return',
        webhookUrl: 'https://example.com/webhook',
        localPaymentId: 'pay-local-2',
      })

      expect(result.redirectUrl).toBe(
        'https://www.mercadopago.cl/redirect?pref_id=pref-456',
      )
    })

    it('includes notification_url in preference', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            id: 'pref-789',
            init_point: 'https://www.mercadopago.cl/redirect?pref_id=pref-789',
            sandbox_init_point: 'https://sandbox.mercadopago.cl/redirect?pref_id=pref-789',
          }),
      })

      await provider.createPayment({
        amount: 10000,
        currency: 'CLP',
        bookingId: 'booking-3',
        description: 'Test',
        returnUrl: 'https://example.com/return',
        webhookUrl: 'https://example.com/api/webhooks/mercado-pago',
        localPaymentId: 'pay-local-3',
      })

      const fetchCall = mockFetch.mock.calls[0] as [string, RequestInit]
      const body = JSON.parse(fetchCall[1].body as string)

      expect(body.notification_url).toBe('https://example.com/api/webhooks/mercado-pago')
    })

    it('does NOT include auto_return in preference', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            id: 'pref-999',
            init_point: 'https://www.mercadopago.cl/redirect?pref_id=pref-999',
            sandbox_init_point: 'https://sandbox.mercadopago.cl/redirect?pref_id=pref-999',
          }),
      })

      await provider.createPayment({
        amount: 10000,
        currency: 'CLP',
        bookingId: 'booking-4',
        description: 'Test',
        returnUrl: 'https://example.com/return',
        webhookUrl: 'https://example.com/webhook',
        localPaymentId: 'pay-local-4',
      })

      const fetchCall = mockFetch.mock.calls[0] as [string, RequestInit]
      const body = JSON.parse(fetchCall[1].body as string)

      expect(body.auto_return).toBeUndefined()
    })

    it('throws clear error without MERCADO_PAGO_ACCESS_TOKEN', async () => {
      setEnv({ MERCADO_PAGO_ACCESS_TOKEN: undefined, NODE_ENV: 'development' })
      vi.resetModules()
      provider = await getProvider()

      await expect(
        provider.createPayment({
          amount: 10000,
          currency: 'CLP',
          bookingId: 'booking-1',
          description: 'Test',
          returnUrl: 'https://example.com/return',
          webhookUrl: 'https://example.com/webhook',
          localPaymentId: 'pay-local-1',
        }),
      ).rejects.toThrow('MERCADO_PAGO_ACCESS_TOKEN')
    })

    it('throws when localPaymentId is missing', async () => {
      await expect(
        provider.createPayment({
          amount: 10000,
          currency: 'CLP',
          bookingId: 'booking-1',
          description: 'Test',
          returnUrl: 'https://example.com/return',
          webhookUrl: 'https://example.com/webhook',
        }),
      ).rejects.toThrow('localPaymentId')
    })
  })

  describe('verifyPayment', () => {
    it('returns approved for approved MP payment', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            id: 'mp-pay-1',
            status: 'approved',
            transaction_amount: 10000,
            date_approved: '2024-01-15T10:30:00Z',
          }),
      })

      const result = await provider.verifyPayment({
        paymentId: 'pay-local-1',
        providerPaymentId: 'mp-pay-1',
      })

      expect(result.status).toBe('approved')
      expect(result.amount).toBe(10000)
      expect(result.paidAt).toBeInstanceOf(Date)
    })

    it('returns pending for in_process MP payment', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            id: 'mp-pay-2',
            status: 'in_process',
            transaction_amount: 10000,
            date_approved: null,
          }),
      })

      const result = await provider.verifyPayment({
        paymentId: 'pay-local-2',
        providerPaymentId: 'mp-pay-2',
      })

      expect(result.status).toBe('pending')
    })

    it('returns rejected for rejected MP payment', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            id: 'mp-pay-3',
            status: 'rejected',
            transaction_amount: 10000,
            date_approved: null,
          }),
      })

      const result = await provider.verifyPayment({
        paymentId: 'pay-local-3',
        providerPaymentId: 'mp-pay-3',
      })

      expect(result.status).toBe('rejected')
    })
  })

  describe('handleWebhook', () => {
    it('fetches MP payment and returns standardized result', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            id: 'mp-pay-w1',
            status: 'approved',
            transaction_amount: 10000,
            date_approved: '2024-01-15T10:30:00Z',
            external_reference: 'pay-local-w1',
          }),
      })

      const result = await provider.handleWebhook({
        data: { id: 'mp-pay-w1' },
      })

      expect(result.status).toBe('approved')
      expect(result.paymentId).toBe('pay-local-w1')
      expect(result.providerPaymentId).toBe('mp-pay-w1')
      expect(result.amount).toBe(10000)
    })

    it('throws when payload has no payment id', async () => {
      await expect(provider.handleWebhook({})).rejects.toThrow(
        'missing payment id',
      )
    })
  })
})
