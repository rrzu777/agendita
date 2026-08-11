import { describe, it, expect, vi, beforeEach } from 'vitest'

const update = vi.fn()
const updateMany = vi.fn()
const findUnique = vi.fn()
const incidentUpsert = vi.fn()
const incidentCreate = vi.fn()
const incidentUpdate = vi.fn()
const incidentDelete = vi.fn()
vi.mock('@/lib/db', () => ({ prisma: { payment: {
  update: (...a: unknown[]) => update(...a),
  updateMany: (...a: unknown[]) => updateMany(...a),
  findUnique: (...a: unknown[]) => findUnique(...a),
}, paymentProviderIncident: {
  upsert: (...a: unknown[]) => incidentUpsert(...a),
  create: (...a: unknown[]) => incidentCreate(...a),
  update: (...a: unknown[]) => incidentUpdate(...a),
  delete: (...a: unknown[]) => incidentDelete(...a),
} } }))

import { createMpPreferenceForPayment } from './create-preference'
import type { CreatePaymentResult, PaymentProvider } from './types'

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
    updateMany.mockReset().mockResolvedValue({ count: 1 })
    findUnique.mockReset()
    incidentUpsert.mockReset()
    incidentCreate.mockReset().mockResolvedValue({ id: 'lease-1' })
    incidentUpdate.mockReset().mockResolvedValue({ id: 'lease-1' })
    incidentDelete.mockReset().mockResolvedValue({ id: 'lease-1' })
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
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'pay1', providerPreferenceId: null },
      data: {
        rawPayload: { preferenceId: 'pref1' },
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
    expect(updateMany).not.toHaveBeenCalled()
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

  it('accepts a concurrent replay only when Mercado Pago returned the same preference', async () => {
    updateMany.mockResolvedValue({ count: 0 })
    findUnique.mockResolvedValue({ providerPreferenceId: 'pref1' })
    await expect(createMpPreferenceForPayment(fakeProvider(), {
      amount: 1, currency: 'CLP', description: 'x', returnUrl: 'https://x/r',
      webhookUrl: 'https://x/w', localPaymentId: 'pay1',
    })).resolves.toMatchObject({ paymentId: 'pay1' })
  })

  it('never overwrites a different preference on the same local payment', async () => {
    updateMany.mockResolvedValue({ count: 0 })
    findUnique.mockResolvedValue({ providerPreferenceId: 'pref-other' })
    await expect(createMpPreferenceForPayment(fakeProvider(), {
      amount: 1, currency: 'CLP', description: 'x', returnUrl: 'https://x/r',
      webhookUrl: 'https://x/w', localPaymentId: 'pay1',
    })).rejects.toThrow(/manual reconciliation/i)
    expect(incidentUpsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ kind: 'preference_conflict', status: 'manual_review' }),
    }))
  })

  it('marks an ambiguous provider POST and never assumes it is safe to retry', async () => {
    const provider = fakeProvider()
    provider.createPayment = vi.fn().mockRejectedValue(Object.assign(new Error('timeout'), {
      name: 'MercadoPagoAmbiguousPreferenceError',
    }))

    await expect(createMpPreferenceForPayment(provider, {
      amount: 1, currency: 'CLP', description: 'x', returnUrl: 'https://x/r',
      webhookUrl: 'https://x/w', localPaymentId: 'pay1',
    })).rejects.toThrow(/manual reconciliation/i)

    expect(incidentUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { dedupeKey: 'preference_creation:pay1' },
      data: expect.objectContaining({ kind: 'preference_creation_ambiguous', status: 'manual_review' }),
    }))
  })

  it('allows only one provider POST for concurrent calls on the same local Payment', async () => {
    const provider = fakeProvider()
    let release!: () => void
    provider.createPayment = vi.fn(() => new Promise<CreatePaymentResult>((resolve) => {
      release = () => resolve({
        paymentId: 'pay1', providerPaymentId: null, redirectUrl: 'https://mp/redirect',
        status: 'pending', rawResponse: { preferenceId: 'pref1' },
      })
    }))
    incidentCreate
      .mockResolvedValueOnce({ id: 'lease-1' })
      .mockRejectedValueOnce(Object.assign(new Error('unique'), { code: 'P2002' }))
    const input = {
      amount: 1, currency: 'CLP', description: 'x', returnUrl: 'https://x/r',
      webhookUrl: 'https://x/w', localPaymentId: 'pay1',
    }

    const first = createMpPreferenceForPayment(provider, input)
    await vi.waitFor(() => expect(provider.createPayment).toHaveBeenCalledTimes(1))
    await expect(createMpPreferenceForPayment(provider, input)).rejects.toThrow(/already|reconciliation|progreso/i)
    expect(provider.createPayment).toHaveBeenCalledTimes(1)
    release()
    await expect(first).resolves.toMatchObject({ paymentId: 'pay1' })
  })
})
