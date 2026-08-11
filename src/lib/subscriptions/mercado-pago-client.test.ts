import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createMpSubscriptionClient,
  MercadoPagoSubscriptionTransportError,
} from './mercado-pago-client'

const config = {
  accessToken: 'test-token-must-never-leak',
  webhookSecret: 'test-webhook-secret-must-never-leak',
  callbackUrl: 'https://app.example.com/api/webhooks/mercado-pago/subscriptions',
  environment: 'sandbox' as const,
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

beforeEach(() => vi.stubGlobal('window', undefined))
afterEach(() => vi.unstubAllGlobals())

describe('createMpSubscriptionClient', () => {
  it('creates a monthly CLP plan using the selected hosted-checkout transport', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        id: 'plan-1',
        status: 'active',
        reason: 'Plan Pro',
        auto_recurring: {
          transaction_amount: 12000,
          currency_id: 'CLP',
          frequency: 1,
          frequency_type: 'months',
        },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const plan = await createMpSubscriptionClient(config).createPlan({
      name: 'Plan Pro',
      amount: 12000,
      externalReference: 'local-op-plan-1',
    })

    expect(plan.id).toBe('plan-1')
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.mercadopago.com/preapproval_plan',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer test-token-must-never-leak',
          'Content-Type': 'application/json',
        }),
        signal: expect.any(AbortSignal),
      }),
    )
    const init = fetchMock.mock.calls[0][1] as RequestInit
    expect(JSON.parse(init.body as string)).toEqual({
      reason: 'Plan Pro',
      external_reference: 'local-op-plan-1',
      back_url: config.callbackUrl,
      auto_recurring: {
        frequency: 1,
        frequency_type: 'months',
        transaction_amount: 12000,
        currency_id: 'CLP',
      },
    })
  })

  it('uses documented endpoints for plan and subscription lifecycle operations', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ id: 'plan-1', status: 'active', auto_recurring: { transaction_amount: 12000, currency_id: 'CLP', frequency: 1, frequency_type: 'months' } }))
      .mockResolvedValueOnce(jsonResponse({ id: 'preapproval-1', status: 'pending', auto_recurring: { transaction_amount: 12000, currency_id: 'CLP', frequency: 1, frequency_type: 'months' }, init_point: 'https://mp.example/checkout' }))
      .mockResolvedValueOnce(jsonResponse({ id: 'preapproval-1', status: 'authorized', auto_recurring: { transaction_amount: 12000, currency_id: 'CLP', frequency: 1, frequency_type: 'months' } }))
      .mockResolvedValueOnce(jsonResponse({ id: 'preapproval-1', status: 'cancelled', auto_recurring: { transaction_amount: 12000, currency_id: 'CLP', frequency: 1, frequency_type: 'months' } }))
    vi.stubGlobal('fetch', fetchMock)
    const client = createMpSubscriptionClient(config)

    await client.getPlan('plan-1')
    await client.createSubscription({
      planId: 'plan-1',
      externalReference: 'local-op-subscription-1',
      payerEmail: 'payer@example.com',
    })
    await client.getSubscription('preapproval-1')
    await client.cancelSubscription('preapproval-1')

    expect(fetchMock.mock.calls.map(([url, init]) => [url, (init as RequestInit).method ?? 'GET'])).toEqual([
      ['https://api.mercadopago.com/preapproval_plan/plan-1', 'GET'],
      ['https://api.mercadopago.com/preapproval', 'POST'],
      ['https://api.mercadopago.com/preapproval/preapproval-1', 'GET'],
      ['https://api.mercadopago.com/preapproval/preapproval-1', 'PUT'],
    ])
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
      preapproval_plan_id: 'plan-1',
      external_reference: 'local-op-subscription-1',
      payer_email: 'payer@example.com',
      back_url: config.callbackUrl,
    })
    expect(JSON.parse(fetchMock.mock.calls[3][1].body)).toEqual({ status: 'cancelled' })
  })

  it('fails the create operation when Mercado Pago does not return hosted checkout', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          id: 'preapproval-no-hosted-checkout',
          status: 'pending',
          auto_recurring: {
            transaction_amount: 12000,
            currency_id: 'CLP',
            frequency: 1,
            frequency_type: 'months',
          },
        }),
      ),
    )

    await expect(
      createMpSubscriptionClient(config).createSubscription({
        planId: 'plan-1',
        externalReference: 'local-op-subscription-no-hosted-checkout',
      }),
    ).rejects.toEqual(
      expect.objectContaining({ name: 'MercadoPagoSubscriptionContractError' }),
    )
  })

  it('gets and searches invoices by preapproval id', async () => {
    const invoice = {
      id: 'invoice-1',
      status: 'approved',
      preapproval_id: 'preapproval-1',
      transaction_amount: 12000,
      currency_id: 'CLP',
    }
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(invoice))
      .mockResolvedValueOnce(jsonResponse({ results: [invoice] }))
    vi.stubGlobal('fetch', fetchMock)
    const client = createMpSubscriptionClient(config)

    await expect(client.getInvoice('invoice-1')).resolves.toMatchObject({ id: 'invoice-1' })
    await expect(client.searchInvoices('preapproval-1')).resolves.toHaveLength(1)
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'https://api.mercadopago.com/authorized_payments/invoice-1',
      'https://api.mercadopago.com/authorized_payments/search?preapproval_id=preapproval-1',
    ])
  })

  it('sanitizes upstream failures without exposing response bodies or credentials', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(`provider body ${config.accessToken} ${config.webhookSecret}`, {
          status: 401,
        }),
      ),
    )

    await expect(createMpSubscriptionClient(config).getPlan('plan-1')).rejects.toEqual(
      expect.objectContaining({
        name: 'MercadoPagoSubscriptionTransportError',
        message: 'Mercado Pago subscriptions request failed (HTTP 401).',
      }),
    )
    await expect(createMpSubscriptionClient(config).getPlan('plan-1')).rejects.toBeInstanceOf(
      MercadoPagoSubscriptionTransportError,
    )
  })
})
