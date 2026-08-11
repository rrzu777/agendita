import { describe, expect, it } from 'vitest'

import {
  MercadoPagoSubscriptionContractError,
  normalizeMpInvoice,
  normalizeMpSubscription,
} from './mercado-pago-mappers'

describe('Mercado Pago subscription mappers', () => {
  it('normalizes a hosted monthly CLP subscription while preserving the raw provider response', () => {
    const raw = {
      id: 'preapproval-1',
      status: 'authorized',
      external_reference: 'local-operation-opaque',
      init_point: 'https://www.mercadopago.cl/subscriptions/checkout',
      auto_recurring: {
        transaction_amount: 12000,
        currency_id: 'CLP',
        frequency: 1,
        frequency_type: 'months',
      },
      next_payment_date: '2026-09-11T00:00:00.000Z',
    }

    expect(normalizeMpSubscription(raw)).toMatchObject({
      id: 'preapproval-1',
      status: 'active',
      externalReference: 'local-operation-opaque',
      checkoutUrl: 'https://www.mercadopago.cl/subscriptions/checkout',
      amount: 12000,
      currency: 'CLP',
      frequency: 1,
      frequencyType: 'months',
      raw,
    })
  })

  it('maps an unknown subscription status to ignored', () => {
    expect(
      normalizeMpSubscription({
        id: 'preapproval-unknown',
        status: 'a_future_provider_status',
        auto_recurring: {
          transaction_amount: 12000,
          currency_id: 'CLP',
          frequency: 1,
          frequency_type: 'months',
        },
      }).status,
    ).toBe('ignored')
  })

  it('accepts Mercado Pago integer amounts serialized as strings', () => {
    expect(
      normalizeMpSubscription({
        id: 'preapproval-string-amount',
        status: 'authorized',
        auto_recurring: {
          transaction_amount: '12000',
          currency_id: 'CLP',
          frequency: 1,
          frequency_type: 'months',
        },
      }).amount,
    ).toBe(12000)
  })

  it('normalizes approved invoices and keeps unknown invoice states ignored', () => {
    const raw = {
      id: 'invoice-1',
      status: 'approved',
      preapproval_id: 'preapproval-1',
      transaction_amount: 12000,
      currency_id: 'CLP',
      date_approved: '2026-08-11T12:00:00.000Z',
    }

    expect(normalizeMpInvoice(raw)).toMatchObject({
      id: 'invoice-1',
      subscriptionId: 'preapproval-1',
      status: 'approved',
      amount: 12000,
      currency: 'CLP',
      raw,
    })
    expect(
      normalizeMpInvoice({
        ...raw,
        status: 'eventually_approved_maybe',
      }).status,
    ).toBe('ignored')
  })

  it('uses the known nested payment result for an authorized-payment invoice', () => {
    expect(
      normalizeMpInvoice({
        id: 'invoice-authorized-payment',
        status: 'scheduled',
        preapproval_id: 'preapproval-1',
        transaction_amount: '12000',
        currency_id: 'CLP',
        payment: { status: 'approved' },
      }),
    ).toMatchObject({ amount: 12000, status: 'approved' })
  })

  it.each([
    { transaction_amount: 12.5, currency_id: 'CLP' },
    { transaction_amount: 0, currency_id: 'CLP' },
    { transaction_amount: 12000, currency_id: 'USD' },
  ])('rejects an invalid CLP amount contract %#', (autoRecurring) => {
    expect(() =>
      normalizeMpSubscription({
        id: 'preapproval-invalid-amount',
        status: 'authorized',
        auto_recurring: {
          ...autoRecurring,
          frequency: 1,
          frequency_type: 'months',
        },
      }),
    ).toThrow(MercadoPagoSubscriptionContractError)
  })

  it('rejects an invalid provider date before a local transition can be attempted', () => {
    expect(() =>
      normalizeMpInvoice({
        id: 'invoice-invalid-date',
        status: 'approved',
        preapproval_id: 'preapproval-1',
        transaction_amount: 12000,
        currency_id: 'CLP',
        date_approved: 'not-a-date',
      }),
    ).toThrow(MercadoPagoSubscriptionContractError)
  })
})
