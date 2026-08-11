import { describe, it, expect, vi, beforeEach } from 'vitest'

const update = vi.fn()
vi.mock('@/lib/db', () => ({ prisma: { payment: { update: (...a: unknown[]) => update(...a) } } }))

import { createMpPreferenceForPayment } from './create-preference'
import type { PaymentProvider } from './types'

function fakeProvider(): PaymentProvider {
  return {
    name: 'mercado_pago',
    createPayment: vi.fn().mockResolvedValue({
      paymentId: 'pay1', providerPaymentId: null, redirectUrl: 'https://mp/redirect',
      status: 'pending', rawResponse: { preferenceId: 'pref1', init_point: 'https://mp/redirect' },
    }),
    verifyPayment: vi.fn(), handleWebhook: vi.fn(),
    refundPayment: vi.fn().mockResolvedValue({ refundId: null, status: 'refunded', rawResponse: {} }),
  }
}

function capturingProvider(capture: (input: Parameters<PaymentProvider['createPayment']>[0]) => void): PaymentProvider {
  const provider = fakeProvider()
  provider.createPayment = vi.fn(async (input) => {
    capture(input)
    return {
      paymentId: 'pay1', providerPaymentId: null, redirectUrl: 'https://mp/redirect',
      status: 'pending' as const, rawResponse: { preferenceId: 'pref1' },
    }
  })
  return provider
}

describe('createMpPreferenceForPayment', () => {
  beforeEach(() => {
    update.mockReset()
    process.env.MERCADO_PAGO_ENVIRONMENT = 'sandbox'
  })

  it('llama createPayment y persiste rawResponse en el Payment local', async () => {
    const provider = fakeProvider()
    const res = await createMpPreferenceForPayment(provider, {
      amount: 5000, currency: 'CLP', bookingId: '', description: 'Paquete X',
      returnUrl: 'https://x/return', webhookUrl: 'https://x/webhook',
      localPaymentId: 'pay1', customerEmail: 'c@x.cl',
      metadata: { packagePurchaseId: 'pp1', businessId: 'b1', paymentType: 'package_purchase', localPaymentId: 'pay1' },
    })
    expect(res.redirectUrl).toBe('https://mp/redirect')
    expect(update).toHaveBeenCalledWith({
      where: { id: 'pay1' },
      data: {
        rawPayload: { preferenceId: 'pref1', init_point: 'https://mp/redirect' },
        providerPreferenceId: 'pref1',
        providerEnvironment: 'sandbox',
      },
    })
  })

  it('no persiste rawPayload si no hay localPaymentId', async () => {
    const provider = fakeProvider()
    await createMpPreferenceForPayment(provider, {
      amount: 1, currency: 'CLP', bookingId: '', description: 'x',
      returnUrl: 'r', webhookUrl: 'w',
    })
    expect(update).not.toHaveBeenCalled()
  })

  it('passes the local payment locator to Mercado Pago without making it authoritative', async () => {
    let captured: Parameters<PaymentProvider['createPayment']>[0] | undefined
    const provider = capturingProvider((input) => { captured = input })

    await createMpPreferenceForPayment(provider, {
      amount: 5000, currency: 'CLP', description: 'Reserva',
      returnUrl: 'https://agendita.cl/return',
      webhookUrl: 'https://agendita.cl/api/webhooks/mercado-pago',
      localPaymentId: 'pay/with spaces',
    })

    expect(captured?.webhookUrl).toBe(
      'https://agendita.cl/api/webhooks/mercado-pago?local_payment_id=pay%2Fwith+spaces',
    )
  })
})
