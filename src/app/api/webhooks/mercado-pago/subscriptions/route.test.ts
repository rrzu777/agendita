import { createHmac } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  MercadoPagoSubscriptionContractError,
  normalizeMpInvoice,
} from '@/lib/subscriptions/mercado-pago-mappers'

const mocks = vi.hoisted(() => ({
  process: vi.fn(),
  runtime: vi.fn(),
}))

vi.mock('@/lib/subscriptions/webhook', async (importActual) => ({
  ...(await importActual<typeof import('@/lib/subscriptions/webhook')>()),
  processSubscriptionWebhook: (...args: unknown[]) => mocks.process(...args),
  getSubscriptionWebhookRuntime: () => mocks.runtime(),
}))

const SECRET = 'subscriptions-webhook-secret'
const RESOURCE_ID = 'invoice-1'

function signature(resourceId: string, requestId: string | null): string {
  const timestamp = '1786459200'
  const manifest = `id:${resourceId};request-id:${requestId ?? ''};ts:${timestamp};`
  const digest = createHmac('sha256', SECRET).update(manifest).digest('hex')
  return `ts=${timestamp},v1=${digest}`
}

function request(input: {
  body?: unknown
  queryId?: string
  signature?: string | null
  requestId?: string | null
} = {}): Request {
  const requestId = input.requestId === undefined ? 'request-1' : input.requestId
  const url = new URL('https://app.example.com/api/webhooks/mercado-pago/subscriptions')
  if (input.queryId) url.searchParams.set('data.id', input.queryId)
  const headers = new Headers({ 'content-type': 'application/json' })
  if (requestId) headers.set('x-request-id', requestId)
  const signatureHeader = input.signature === undefined
    ? signature(input.queryId ?? RESOURCE_ID, requestId)
    : input.signature
  if (signatureHeader) headers.set('x-signature', signatureHeader)
  return new Request(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(input.body ?? {
      type: 'subscription_authorized_payment',
      live_mode: false,
      data: { id: RESOURCE_ID },
    }),
  })
}

describe('Mercado Pago recurring subscriptions webhook route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.runtime.mockReturnValue({
      webhookSecret: SECRET,
      dependencies: { environment: 'sandbox' },
    })
    mocks.process.mockResolvedValue({ outcome: 'applied', status: 'active' })
  })

  it('authenticates and delegates a supported event', async () => {
    const { POST } = await import('./route')
    const response = await POST(request())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true, outcome: 'applied' })
    expect(mocks.process).toHaveBeenCalledWith({
      topic: 'subscription_authorized_payment',
      resourceId: RESOURCE_ID,
      liveMode: false,
    }, expect.objectContaining({ environment: 'sandbox' }))
  })

  it('returns 200 for an idempotent duplicate', async () => {
    mocks.process.mockResolvedValue({ outcome: 'duplicate', status: 'active' })
    const { POST } = await import('./route')

    const response = await POST(request())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true, outcome: 'duplicate' })
  })

  it('rejects an invalid signature before invoking the processor', async () => {
    const { POST } = await import('./route')

    const response = await POST(request({ signature: 'ts=1786459200,v1=bad' }))

    expect(response.status).toBe(401)
    expect(mocks.process).not.toHaveBeenCalled()
  })

  it('rejects inconsistent query and body resource IDs before mutation', async () => {
    const { POST } = await import('./route')

    const response = await POST(request({ queryId: 'query-id' }))

    expect(response.status).toBe(400)
    expect(mocks.process).not.toHaveBeenCalled()
  })

  it('rejects unsupported topics and malformed live_mode', async () => {
    const { POST } = await import('./route')
    const response = await POST(request({
      body: { type: 'payment', live_mode: 'false', data: { id: RESOURCE_ID } },
    }))

    expect(response.status).toBe(400)
    expect(mocks.process).not.toHaveBeenCalled()
  })

  it('maps authoritative inconsistencies to 400 without details', async () => {
    const { SubscriptionWebhookValidationError } = await import('@/lib/subscriptions/webhook')
    mocks.process.mockRejectedValue(new SubscriptionWebhookValidationError())
    const { POST } = await import('./route')

    const response = await POST(request())

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'Invalid webhook event' })
  })

  it('maps provider timeouts to 502 so Mercado Pago retries', async () => {
    const { MercadoPagoSubscriptionTransportError } = await import('@/lib/subscriptions/mercado-pago-client')
    mocks.process.mockRejectedValue(new MercadoPagoSubscriptionTransportError())
    const { POST } = await import('./route')

    const response = await POST(request())

    expect(response.status).toBe(502)
    await expect(response.json()).resolves.toEqual({ error: 'Provider temporarily unavailable' })
  })

  it.each([
    ['currency', {
      id: 'invoice-invalid-currency', status: 'approved', preapproval_id: 'subscription-1',
      transaction_amount: 14990, currency_id: 'USD',
    }],
    ['date', {
      id: 'invoice-invalid-date', status: 'approved', preapproval_id: 'subscription-1',
      transaction_amount: 14990, currency_id: 'CLP', date_approved: '2026-02-30T00:00:00.000Z',
    }],
    ['status shape', {
      id: 'invoice-invalid-status', status: 'scheduled', preapproval_id: 'subscription-1',
      transaction_amount: 14990, currency_id: 'CLP', payment: { id: 1, status: { value: 'approved' } },
    }],
  ])(
    'maps an invalid authoritative %s contract to 400',
    async (_label, rawInvoice) => {
      let contractError: unknown
      try {
        normalizeMpInvoice(rawInvoice)
      } catch (error) {
        contractError = error
      }
      expect(contractError).toBeInstanceOf(MercadoPagoSubscriptionContractError)
      mocks.process.mockRejectedValue(contractError)
      const { POST } = await import('./route')

      const response = await POST(request())

      expect(response.status).toBe(400)
      await expect(response.json()).resolves.toEqual({ error: 'Invalid webhook event' })
    },
  )
})
