import { createHash } from 'node:crypto'
import type { PrismaClient } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { MpSubscriptionClient } from './mercado-pago-client'
import { SubscriptionTransitionConflictError } from './transition'
import { CheckoutEligibilityConflictError } from './checkout-adoption'
import {
  processSubscriptionWebhook,
  SubscriptionWebhookValidationError,
  type SubscriptionWebhookDependencies,
} from './webhook'

const REFERENCE = 'opaque-checkout-reference'
const REFERENCE_HASH = createHash('sha256').update(REFERENCE).digest('hex')
const PAID_AT = new Date('2026-08-11T12:00:00.000Z')
const NEXT_PAYMENT_AT = new Date('2026-09-11T12:00:00.000Z')

const providerSubscription = {
  id: 'provider-subscription-1',
  status: 'active' as const,
  providerStatus: 'authorized',
  collectorId: 'agendita-account-1',
  planId: 'provider-plan-1',
  externalReference: REFERENCE,
  checkoutUrl: null,
  amount: 14990,
  currency: 'CLP' as const,
  frequency: 1 as const,
  frequencyType: 'months' as const,
  nextPaymentAt: NEXT_PAYMENT_AT,
  updatedAt: PAID_AT,
}

const approvedInvoice = {
  id: 'invoice-1',
  subscriptionId: providerSubscription.id,
  status: 'approved' as const,
  providerPaymentId: 'payment-1',
  providerStatus: 'approved',
  amount: 14990,
  currency: 'CLP' as const,
  externalReference: REFERENCE,
  approvedAt: PAID_AT,
  createdAt: PAID_AT,
  updatedAt: PAID_AT,
  debitAt: PAID_AT,
}

const localSubscription = {
  id: 'subscription-1',
  businessId: 'business-1',
  planId: 'plan-1',
  status: 'past_due',
  interval: 'monthly',
  amount: 14990,
  currency: 'CLP',
  provider: 'mercado_pago',
  environment: 'sandbox',
  providerPlanId: 'provider-plan-1',
  providerSubscriptionId: providerSubscription.id,
  billingEnabled: true,
  complimentaryUntil: null,
  updatedAt: new Date('2026-08-10T00:00:00.000Z'),
}

const checkoutAttempt = {
  id: 'attempt-1',
  businessId: localSubscription.businessId,
  subscriptionId: localSubscription.id,
  environment: 'sandbox',
  referenceHash: REFERENCE_HASH,
  providerSubscriptionId: providerSubscription.id,
  providerPlanId: providerSubscription.planId,
  planId: localSubscription.planId,
  amount: localSubscription.amount,
  currency: localSubscription.currency,
  invalidatedAt: PAID_AT,
  subscription: { ...localSubscription, plan: { id: localSubscription.planId } },
}

function createDependencies(): SubscriptionWebhookDependencies & {
  applyTransition: ReturnType<typeof vi.fn>
  adoptCandidate: ReturnType<typeof vi.fn>
  client: MpSubscriptionClient & {
    getInvoice: ReturnType<typeof vi.fn>
    getSubscription: ReturnType<typeof vi.fn>
    getCurrentAccountId: ReturnType<typeof vi.fn>
    cancelSubscription: ReturnType<typeof vi.fn>
  }
} {
  const prisma = {
    businessSubscription: { findFirst: vi.fn().mockResolvedValue(localSubscription) },
    subscriptionCheckoutAttempt: {
      findFirst: vi.fn().mockResolvedValue(checkoutAttempt),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    subscriptionPayment: {
      findUnique: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
    },
  } as unknown as PrismaClient
  const client = {
    getInvoice: vi.fn().mockResolvedValue(approvedInvoice),
    getSubscription: vi.fn().mockResolvedValue(providerSubscription),
    getCurrentAccountId: vi.fn().mockResolvedValue('agendita-account-1'),
    cancelSubscription: vi.fn().mockResolvedValue({
      ...providerSubscription,
      status: 'canceled',
      providerStatus: 'canceled',
    }),
  } as unknown as ReturnType<typeof createDependencies>['client']
  return {
    prisma,
    client,
    environment: 'sandbox',
    applyTransition: vi.fn().mockResolvedValue({ applied: true, status: 'active' }),
    adoptCandidate: vi.fn().mockResolvedValue(undefined),
    now: () => new Date('2026-08-11T12:05:00.000Z'),
  }
}

const invoiceEvent = {
  topic: 'subscription_authorized_payment' as const,
  resourceId: approvedInvoice.id,
  liveMode: false,
}

describe('processSubscriptionWebhook', () => {
  let dependencies: ReturnType<typeof createDependencies>

  beforeEach(() => {
    dependencies = createDependencies()
  })

  it('applies an authoritative approved invoice exactly with its provider payment', async () => {
    await expect(processSubscriptionWebhook(invoiceEvent, dependencies)).resolves.toEqual({
      outcome: 'applied',
      status: 'active',
    })
    expect(dependencies.applyTransition).toHaveBeenCalledWith(dependencies.prisma, {
      subscriptionId: localSubscription.id,
      command: {
        type: 'invoice_approved',
        providerPaymentId: approvedInvoice.providerPaymentId,
        paidAt: PAID_AT,
        periodStart: approvedInvoice.debitAt,
        periodEnd: NEXT_PAYMENT_AT,
      },
      payment: {
        providerInvoiceId: approvedInvoice.id,
        providerStatus: approvedInvoice.providerStatus,
        providerUpdatedAt: approvedInvoice.updatedAt,
      },
      expectedProviderSnapshot: {
        provider: 'mercado_pago',
        environment: 'sandbox',
        providerSubscriptionId: providerSubscription.id,
        planId: localSubscription.planId,
        providerPlanId: providerSubscription.planId,
        amount: localSubscription.amount,
        currency: localSubscription.currency,
      },
    })
  })

  it('uses the provider-verified historical period end instead of the current snapshot', async () => {
    const historicalDebitAt = new Date('2026-06-30T12:00:00.000Z')
    const historicalPeriodEnd = new Date('2026-07-30T12:00:00.000Z')
    dependencies.client.getInvoice.mockResolvedValue({
      ...approvedInvoice,
      approvedAt: new Date('2026-07-02T12:00:00.000Z'),
      debitAt: historicalDebitAt,
    })

    await processSubscriptionWebhook({
      ...invoiceEvent,
      periodEnd: historicalPeriodEnd,
    }, dependencies)

    expect(dependencies.applyTransition).toHaveBeenCalledWith(
      dependencies.prisma,
      expect.objectContaining({
        command: expect.objectContaining({
          type: 'invoice_approved',
          periodStart: historicalDebitAt,
          periodEnd: historicalPeriodEnd,
        }),
      }),
    )
  })

  it('marks a rejected invoice past due using its debit date', async () => {
    dependencies.client.getInvoice.mockResolvedValue({
      ...approvedInvoice,
      status: 'failed',
      providerPaymentId: 'failed-payment-1',
      providerStatus: 'rejected',
      approvedAt: null,
    })

    await processSubscriptionWebhook(invoiceEvent, dependencies)

    expect(dependencies.applyTransition).toHaveBeenCalledWith(dependencies.prisma, {
      subscriptionId: localSubscription.id,
      command: { type: 'invoice_failed', occurredAt: PAID_AT },
      payment: {
        providerPaymentId: 'failed-payment-1',
        providerInvoiceId: approvedInvoice.id,
        providerStatus: 'rejected',
        providerUpdatedAt: approvedInvoice.updatedAt,
      },
      expectedProviderSnapshot: {
        provider: 'mercado_pago',
        environment: 'sandbox',
        providerSubscriptionId: providerSubscription.id,
        planId: localSubscription.planId,
        providerPlanId: providerSubscription.planId,
        amount: localSubscription.amount,
        currency: localSubscription.currency,
      },
    })
  })

  it('does not short-circuit an invoice that evolved from rejected to approved', async () => {
    ;(dependencies.prisma.subscriptionPayment.findMany as ReturnType<typeof vi.fn>)
      .mockResolvedValue([{
        id: 'failed-claim',
        businessId: localSubscription.businessId,
        subscriptionId: localSubscription.id,
        provider: 'mercado_pago',
        environment: 'sandbox',
        status: 'rejected',
      }])

    await expect(processSubscriptionWebhook(invoiceEvent, dependencies)).resolves.toEqual({
      outcome: 'applied',
      status: 'active',
    })
    expect(dependencies.applyTransition).toHaveBeenCalledTimes(1)
  })

  it('retries a concurrent failed-invoice CAS once against the new local snapshot', async () => {
    dependencies.client.getInvoice.mockResolvedValue({
      ...approvedInvoice,
      status: 'failed',
      providerStatus: 'rejected',
      approvedAt: null,
    })
    dependencies.applyTransition
      .mockRejectedValueOnce(new SubscriptionTransitionConflictError())
      .mockResolvedValueOnce({ applied: false, status: 'past_due' })

    await expect(processSubscriptionWebhook(invoiceEvent, dependencies)).resolves.toEqual({
      outcome: 'duplicate',
      status: 'past_due',
    })
    expect(dependencies.applyTransition).toHaveBeenCalledTimes(2)
    expect(dependencies.client.getInvoice).toHaveBeenCalledTimes(1)
    expect(dependencies.client.getSubscription).toHaveBeenCalledTimes(1)
  })

  it('ignores pending invoices without mutating state', async () => {
    dependencies.client.getInvoice.mockResolvedValue({
      ...approvedInvoice,
      status: 'pending',
      providerPaymentId: null,
      providerStatus: 'pending',
      approvedAt: null,
    })

    await expect(processSubscriptionWebhook(invoiceEvent, dependencies)).resolves.toEqual({
      outcome: 'ignored',
    })
    expect(dependencies.applyTransition).not.toHaveBeenCalled()
  })

  it('records provider cancellation without ending the paid period immediately', async () => {
    dependencies.client.getSubscription.mockResolvedValue({
      ...providerSubscription,
      status: 'canceled',
      providerStatus: 'canceled',
    })

    await processSubscriptionWebhook({
      topic: 'subscription_preapproval',
      resourceId: providerSubscription.id,
      liveMode: false,
    }, dependencies)

    expect(dependencies.applyTransition).toHaveBeenCalledWith(dependencies.prisma, {
      subscriptionId: localSubscription.id,
      command: { type: 'provider_cancelled', occurredAt: PAID_AT },
      expectedProviderSnapshot: {
        provider: 'mercado_pago',
        environment: 'sandbox',
        providerSubscriptionId: providerSubscription.id,
        planId: localSubscription.planId,
        providerPlanId: providerSubscription.planId,
        amount: localSubscription.amount,
        currency: localSubscription.currency,
      },
    })
  })

  it.each([
    ['duplicate', { applied: false, status: 'active' }],
    ['out_of_order', { applied: false, status: 'active' }],
  ])('returns a successful no-op for a %s approved delivery', async (_name, transitionResult) => {
    dependencies.applyTransition.mockResolvedValue(transitionResult)

    await expect(processSubscriptionWebhook(invoiceEvent, dependencies)).resolves.toEqual({
      outcome: 'duplicate',
      status: 'active',
    })
  })

  it('adopts an authorized checkout candidate through the existing eligibility CAS', async () => {
    ;(dependencies.prisma.businessSubscription.findFirst as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ ...localSubscription, providerSubscriptionId: providerSubscription.id })
    dependencies.prisma.subscriptionCheckoutAttempt.findFirst = vi.fn().mockResolvedValue({
      ...checkoutAttempt,
      invalidatedAt: null,
      subscription: {
        ...checkoutAttempt.subscription,
        providerSubscriptionId: null,
      },
    })

    await processSubscriptionWebhook(invoiceEvent, dependencies)

    expect(dependencies.adoptCandidate).toHaveBeenCalledTimes(1)
    expect(dependencies.adoptCandidate).toHaveBeenCalledWith(expect.objectContaining({
      candidate: providerSubscription,
      attemptId: checkoutAttempt.id,
      environment: 'sandbox',
      providerPlanId: providerSubscription.planId,
    }))
  })

  it.each([
    ['billing rollout revoked', { billingEnabled: false }],
    ['complimentary exemption added', { complimentaryUntil: new Date('2026-09-01T00:00:00.000Z') }],
  ])('settles an approved candidate and cancels future renewals when %s', async (_name, localPatch) => {
    ;(dependencies.prisma.businessSubscription.findFirst as ReturnType<typeof vi.fn>)
      .mockResolvedValue(null)
    dependencies.prisma.subscriptionCheckoutAttempt.findFirst = vi.fn().mockResolvedValue({
      ...checkoutAttempt,
      invalidatedAt: null,
      subscription: {
        ...checkoutAttempt.subscription,
        ...localPatch,
        providerSubscriptionId: null,
      },
    })
    dependencies.adoptCandidate.mockRejectedValue(new CheckoutEligibilityConflictError())

    await expect(processSubscriptionWebhook(invoiceEvent, dependencies)).resolves.toMatchObject({
      outcome: 'applied',
      status: 'active',
    })

    expect(dependencies.client.cancelSubscription).toHaveBeenCalledWith(providerSubscription.id)
    expect(dependencies.applyTransition).toHaveBeenCalledWith(dependencies.prisma, expect.objectContaining({
      subscriptionId: checkoutAttempt.subscriptionId,
      recoveryAdoption: {
        attemptId: checkoutAttempt.id,
        businessId: checkoutAttempt.businessId,
        environment: checkoutAttempt.environment,
        providerSubscriptionId: providerSubscription.id,
        providerPlanId: providerSubscription.planId,
        planId: checkoutAttempt.planId,
        amount: checkoutAttempt.amount,
        currency: checkoutAttempt.currency,
        requestedAt: new Date('2026-08-11T12:05:00.000Z'),
      },
    }))
    expect(dependencies.prisma.subscriptionCheckoutAttempt.updateMany).not.toHaveBeenCalled()
  })

  it('compensates an authorized candidate without an approved invoice', async () => {
    ;(dependencies.prisma.businessSubscription.findFirst as ReturnType<typeof vi.fn>)
      .mockResolvedValue(null)
    dependencies.adoptCandidate.mockRejectedValue(new CheckoutEligibilityConflictError())

    await expect(processSubscriptionWebhook({
      topic: 'subscription_preapproval',
      resourceId: providerSubscription.id,
      liveMode: false,
    }, dependencies)).rejects.toBeInstanceOf(SubscriptionWebhookValidationError)

    expect(dependencies.client.cancelSubscription).toHaveBeenCalledWith(providerSubscription.id)
    expect(dependencies.prisma.subscriptionCheckoutAttempt.updateMany).toHaveBeenCalledWith({
      where: { id: checkoutAttempt.id, invalidatedAt: null },
      data: { invalidatedAt: new Date('2026-08-11T12:05:00.000Z') },
    })
    expect(dependencies.applyTransition).not.toHaveBeenCalled()
  })

  it('keeps an approved recovery settled when cancellation fails and retries cancellation idempotently', async () => {
    const { MercadoPagoSubscriptionTransportError } = await import('./mercado-pago-client')
    ;(dependencies.prisma.businessSubscription.findFirst as ReturnType<typeof vi.fn>)
      .mockResolvedValue(null)
    dependencies.adoptCandidate.mockRejectedValue(new CheckoutEligibilityConflictError())
    dependencies.client.cancelSubscription.mockRejectedValueOnce(
      new MercadoPagoSubscriptionTransportError(),
    )

    await expect(processSubscriptionWebhook(invoiceEvent, dependencies))
      .rejects.toBeInstanceOf(MercadoPagoSubscriptionTransportError)
    expect(dependencies.applyTransition).toHaveBeenCalledTimes(1)

    ;(dependencies.prisma.businessSubscription.findFirst as ReturnType<typeof vi.fn>)
      .mockResolvedValue({
        ...localSubscription,
        status: 'active',
        cancelAtPeriodEnd: true,
        cancellationRequestedAt: new Date('2026-08-11T12:05:00.000Z'),
      })
    dependencies.applyTransition.mockResolvedValueOnce({ applied: false, status: 'active' })
    dependencies.client.cancelSubscription.mockResolvedValueOnce({
      ...providerSubscription,
      status: 'canceled',
      providerStatus: 'canceled',
    })

    await expect(processSubscriptionWebhook(invoiceEvent, dependencies)).resolves.toMatchObject({
      outcome: 'duplicate',
      status: 'active',
    })
    expect(dependencies.applyTransition).toHaveBeenCalledTimes(2)
    expect(dependencies.client.cancelSubscription).toHaveBeenCalledTimes(2)
  })

  it('returns duplicate when remote cancellation succeeded after a lost response', async () => {
    ;(dependencies.prisma.businessSubscription.findFirst as ReturnType<typeof vi.fn>)
      .mockResolvedValue({
        ...localSubscription,
        status: 'active',
        cancelAtPeriodEnd: true,
        cancellationRequestedAt: new Date('2026-08-11T12:05:00.000Z'),
      })
    dependencies.client.getSubscription.mockResolvedValue({
      ...providerSubscription,
      status: 'canceled',
      providerStatus: 'canceled',
      nextPaymentAt: null,
    })
    ;(dependencies.prisma.subscriptionPayment.findMany as ReturnType<typeof vi.fn>)
      .mockResolvedValue([{
        id: 'settled-payment-1',
        businessId: localSubscription.businessId,
        subscriptionId: localSubscription.id,
        provider: 'mercado_pago',
        environment: 'sandbox',
        status: 'approved',
      }])

    await expect(processSubscriptionWebhook(invoiceEvent, dependencies)).resolves.toEqual({
      outcome: 'duplicate',
      status: 'active',
    })
    expect(dependencies.applyTransition).not.toHaveBeenCalled()
    expect(dependencies.client.cancelSubscription).not.toHaveBeenCalled()
  })

  it('rejects an unknown provider subscription without applying a transition', async () => {
    ;(dependencies.prisma.businessSubscription.findFirst as ReturnType<typeof vi.fn>)
      .mockResolvedValue(null)
    dependencies.prisma.subscriptionCheckoutAttempt.findFirst = vi.fn().mockResolvedValue(null)

    await expect(processSubscriptionWebhook(invoiceEvent, dependencies))
      .rejects.toBeInstanceOf(SubscriptionWebhookValidationError)
    expect(dependencies.applyTransition).not.toHaveBeenCalled()
  })

  it.each([
    ['amount', { amount: 15990 }],
    ['currency', { currency: 'ARS' }],
    ['collector', { collectorId: 'another-account' }],
    ['subscription', { id: 'another-subscription' }],
    ['reference', { externalReference: 'another-reference' }],
  ])('rejects a mismatched %s before mutation', async (_field, subscriptionPatch) => {
    if (_field === 'subscription') {
      dependencies.client.getInvoice.mockResolvedValue({
        ...approvedInvoice,
        subscriptionId: 'another-subscription',
      })
    } else {
      dependencies.client.getSubscription.mockResolvedValue({
        ...providerSubscription,
        ...subscriptionPatch,
      })
    }

    await expect(processSubscriptionWebhook(invoiceEvent, dependencies))
      .rejects.toBeInstanceOf(SubscriptionWebhookValidationError)
    expect(dependencies.applyTransition).not.toHaveBeenCalled()
    expect(dependencies.adoptCandidate).not.toHaveBeenCalled()
  })

  it.each([
    ['amount', { amount: 14991 }],
    ['currency', { currency: 'USD' }],
    ['reference', { externalReference: 'invoice-from-another-checkout' }],
  ])('rejects an invoice with a mismatched %s before mutation', async (_field, invoicePatch) => {
    dependencies.client.getInvoice.mockResolvedValue({
      ...approvedInvoice,
      ...invoicePatch,
    })

    await expect(processSubscriptionWebhook(invoiceEvent, dependencies))
      .rejects.toBeInstanceOf(SubscriptionWebhookValidationError)
    expect(dependencies.applyTransition).not.toHaveBeenCalled()
  })

  it('rejects a production event received by the sandbox endpoint before network or mutation', async () => {
    await expect(processSubscriptionWebhook({ ...invoiceEvent, liveMode: true }, dependencies))
      .rejects.toBeInstanceOf(SubscriptionWebhookValidationError)
    expect(dependencies.client.getInvoice).not.toHaveBeenCalled()
    expect(dependencies.applyTransition).not.toHaveBeenCalled()
  })

  it('propagates a sanitized provider timeout for the route to retry', async () => {
    const { MercadoPagoSubscriptionTransportError } = await import('./mercado-pago-client')
    dependencies.client.getInvoice.mockRejectedValue(new MercadoPagoSubscriptionTransportError())

    await expect(processSubscriptionWebhook(invoiceEvent, dependencies)).rejects.toMatchObject({
      name: 'MercadoPagoSubscriptionTransportError',
      status: null,
      outcome: 'ambiguous',
    })
    expect(dependencies.applyTransition).not.toHaveBeenCalled()
  })

  it('propagates a sanitized provider contract error without attempting mutation', async () => {
    const { MercadoPagoSubscriptionContractError } = await import('./mercado-pago-mappers')
    dependencies.client.getInvoice.mockRejectedValue(new MercadoPagoSubscriptionContractError())

    await expect(processSubscriptionWebhook(invoiceEvent, dependencies))
      .rejects.toBeInstanceOf(MercadoPagoSubscriptionContractError)
    expect(dependencies.applyTransition).not.toHaveBeenCalled()
    expect(dependencies.adoptCandidate).not.toHaveBeenCalled()
  })

  it('maps a cross-owner payment claim to sanitized webhook validation', async () => {
    dependencies.client.getSubscription.mockResolvedValue({
      ...providerSubscription,
      status: 'canceled',
      providerStatus: 'canceled',
      nextPaymentAt: null,
    })
    ;(dependencies.prisma.subscriptionPayment.findMany as ReturnType<typeof vi.fn>)
      .mockResolvedValue([{
        id: 'other-owner-payment',
        businessId: 'other-business',
        subscriptionId: 'other-subscription',
        provider: 'mercado_pago',
        environment: 'sandbox',
      }])

    await expect(processSubscriptionWebhook(invoiceEvent, dependencies))
      .rejects.toBeInstanceOf(SubscriptionWebhookValidationError)
    expect(dependencies.applyTransition).not.toHaveBeenCalled()
  })
})
