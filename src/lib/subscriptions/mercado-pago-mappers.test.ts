import { describe, expect, it } from 'vitest'

import {
  MercadoPagoSubscriptionContractError,
  normalizeMpInvoice,
  normalizeMpSubscription,
} from './mercado-pago-mappers'

describe('Mercado Pago subscription mappers', () => {
  it('normalizes a hosted monthly CLP subscription without leaking the raw provider response', () => {
    const raw = {
      id: 'preapproval-1',
      status: 'authorized',
      preapproval_plan_id: 'provider-plan-1',
      collector_id: 998877,
      external_reference: 'local-operation-opaque',
      init_point: 'https://www.mercadopago.cl/subscriptions/checkout',
      auto_recurring: {
        transaction_amount: 12000,
        currency_id: 'CLP',
        frequency: 1,
        frequency_type: 'months',
      },
      next_payment_date: '2026-09-11T00:00:00.000Z',
      last_modified: '2026-08-11T12:01:00.000Z',
    }

    expect(normalizeMpSubscription(raw)).toMatchObject({
      id: 'preapproval-1',
      status: 'active',
      providerStatus: 'authorized',
      planId: 'provider-plan-1',
      collectorId: '998877',
      externalReference: 'local-operation-opaque',
      checkoutUrl: 'https://www.mercadopago.cl/subscriptions/checkout',
      amount: 12000,
      currency: 'CLP',
      frequency: 1,
      frequencyType: 'months',
      updatedAt: new Date('2026-08-11T12:01:00.000Z'),
    })
    expect(normalizeMpSubscription(raw)).not.toHaveProperty('raw')
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

  it('maps Mercado Pago canceled subscriptions using the provider spelling', () => {
    expect(
      normalizeMpSubscription({
        id: 'preapproval-canceled',
        status: 'canceled',
        auto_recurring: {
          transaction_amount: 12000,
          currency_id: 'CLP',
          frequency: 1,
          frequency_type: 'months',
        },
      }).status,
    ).toBe('canceled')
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
    })
    expect(normalizeMpInvoice(raw)).not.toHaveProperty('raw')
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
        external_reference: 'local-operation-opaque',
        transaction_amount: '12000',
        currency_id: 'CLP',
        date_created: '2026-08-11T11:59:00.000Z',
        last_modified: '2026-08-11T12:00:00.000Z',
        debit_date: '2026-08-11T12:00:00.000Z',
        payment: { id: 778899, status: 'approved' },
      }),
    ).toMatchObject({
      amount: 12000,
      status: 'approved',
      providerPaymentId: '778899',
      providerStatus: 'approved',
      externalReference: 'local-operation-opaque',
      createdAt: new Date('2026-08-11T11:59:00.000Z'),
      updatedAt: new Date('2026-08-11T12:00:00.000Z'),
      debitAt: new Date('2026-08-11T12:00:00.000Z'),
    })
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

  it.each(['not-a-date', '2026-02-30T12:00:00.000Z'])('rejects an impossible provider date: %s', (dateApproved) => {
    expect(() =>
      normalizeMpInvoice({
        id: 'invoice-invalid-date',
        status: 'approved',
        preapproval_id: 'preapproval-1',
        transaction_amount: 12000,
        currency_id: 'CLP',
        date_approved: dateApproved,
      }),
    ).toThrow(MercadoPagoSubscriptionContractError)
  })

  it('accepts calendar-valid end-of-month dates and numeric offsets', () => {
    expect(
      normalizeMpInvoice({
        id: 'invoice-valid-date',
        status: 'approved',
        preapproval_id: 'preapproval-1',
        transaction_amount: 12000,
        currency_id: 'CLP',
        date_approved: '2028-02-29T23:59:59.123-03:00',
      }).approvedAt?.toISOString(),
    ).toBe('2028-03-01T02:59:59.123Z')
  })
})
