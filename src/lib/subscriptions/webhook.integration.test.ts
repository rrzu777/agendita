import { createHash } from 'node:crypto'
import { PrismaClient } from '@prisma/client'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { prisma } from '@/lib/db'
import { requireTestDatabase } from '../../../tests/integration/setup'
import type { MpSubscriptionClient } from './mercado-pago-client'
import { MercadoPagoSubscriptionTransportError } from './mercado-pago-client'
import { applySubscriptionTransition } from './transition'
import { adoptAuthorizedSubscriptionCandidate } from './checkout-adoption'
import {
  processSubscriptionWebhook,
  SubscriptionWebhookValidationError,
  type SubscriptionWebhookDependencies,
} from './webhook'

requireTestDatabase()

const PLAN_ID = 'subscription-webhook-plan'
const ALT_PLAN_ID = 'subscription-webhook-plan-changed'
const BUSINESS_ID = 'subscription-webhook-business'
const SUBSCRIPTION_ID = 'subscription-webhook-subscription'
const ATTEMPT_ID = 'subscription-webhook-attempt'
const PROVIDER_SUBSCRIPTION_ID = 'provider-subscription-webhook'
const PROVIDER_PLAN_ID = 'provider-plan-webhook'
const CANDIDATE_BUSINESS_ID = 'subscription-webhook-candidate-business'
const CANDIDATE_SUBSCRIPTION_ID = 'subscription-webhook-candidate-subscription'
const CANDIDATE_ATTEMPT_ID = 'subscription-webhook-candidate-attempt'
const CANDIDATE_PROVIDER_SUBSCRIPTION_ID = 'provider-subscription-webhook-candidate'
const REFERENCE = 'subscription-webhook-reference'
const PAID_AT = new Date('2026-08-15T12:00:00.000Z')
const PERIOD_END = new Date('2026-09-15T12:00:00.000Z')
const concurrentPrisma = new PrismaClient()

async function cleanup() {
  const businessIds = [BUSINESS_ID, CANDIDATE_BUSINESS_ID]
  await prisma.subscriptionPayment.deleteMany({ where: { businessId: { in: businessIds } } })
  await prisma.subscriptionLog.deleteMany({ where: { businessId: { in: businessIds } } })
  await prisma.subscriptionCheckoutAttempt.deleteMany({ where: { businessId: { in: businessIds } } })
  await prisma.businessSubscription.deleteMany({ where: { businessId: { in: businessIds } } })
  await prisma.business.deleteMany({ where: { id: { in: businessIds } } })
  await prisma.plan.deleteMany({ where: { id: { in: [PLAN_ID, ALT_PLAN_ID] } } })
}

beforeAll(async () => {
  process.env.MP_SUBSCRIPTIONS_ENABLED = 'true'
  await cleanup()
  await prisma.plan.create({
    data: { id: PLAN_ID, name: 'Webhook plan', priceMonthly: 14990, priceYearly: 149900 },
  })
  await prisma.plan.create({
    data: { id: ALT_PLAN_ID, name: 'Webhook changed plan', priceMonthly: 15990, priceYearly: 159900 },
  })
  await prisma.business.create({
    data: {
      id: BUSINESS_ID,
      name: 'Webhook Business',
      slug: BUSINESS_ID,
      subdomain: BUSINESS_ID,
      ownerUserId: 'subscription-webhook-owner',
      city: 'Santiago',
      planId: PLAN_ID,
      subscriptionStatus: 'past_due',
    },
  })
  await prisma.businessSubscription.create({
    data: {
      id: SUBSCRIPTION_ID,
      businessId: BUSINESS_ID,
      planId: PLAN_ID,
      status: 'past_due',
      interval: 'monthly',
      currentPeriodStart: new Date('2026-08-01T00:00:00.000Z'),
      currentPeriodEnd: new Date('2026-09-01T00:00:00.000Z'),
      amount: 14990,
      currency: 'CLP',
      provider: 'mercado_pago',
      environment: 'sandbox',
      providerPlanId: PROVIDER_PLAN_ID,
      providerSubscriptionId: PROVIDER_SUBSCRIPTION_ID,
      pastDueAt: new Date('2026-08-10T00:00:00.000Z'),
      graceEndsAt: new Date('2026-08-17T00:00:00.000Z'),
      billingEnabled: true,
    },
  })
  await prisma.subscriptionCheckoutAttempt.create({
    data: {
      id: ATTEMPT_ID,
      businessId: BUSINESS_ID,
      subscriptionId: SUBSCRIPTION_ID,
      environment: 'sandbox',
      referenceHash: createHash('sha256').update(REFERENCE).digest('hex'),
      providerSubscriptionId: PROVIDER_SUBSCRIPTION_ID,
      providerPlanId: PROVIDER_PLAN_ID,
      planId: PLAN_ID,
      amount: 14990,
      currency: 'CLP',
      expiresAt: new Date('2026-08-15T13:00:00.000Z'),
      invalidatedAt: new Date('2026-08-15T12:00:00.000Z'),
    },
  })
  await prisma.business.create({
    data: {
      id: CANDIDATE_BUSINESS_ID,
      name: 'Webhook Candidate Business',
      slug: CANDIDATE_BUSINESS_ID,
      subdomain: CANDIDATE_BUSINESS_ID,
      ownerUserId: 'subscription-webhook-candidate-owner',
      city: 'Santiago',
      planId: PLAN_ID,
      subscriptionStatus: 'past_due',
    },
  })
  await prisma.businessSubscription.create({
    data: {
      id: CANDIDATE_SUBSCRIPTION_ID,
      businessId: CANDIDATE_BUSINESS_ID,
      planId: PLAN_ID,
      status: 'past_due',
      interval: 'monthly',
      currentPeriodStart: new Date('2026-08-01T00:00:00.000Z'),
      currentPeriodEnd: new Date('2026-09-01T00:00:00.000Z'),
      amount: 14990,
      currency: 'CLP',
      provider: 'manual',
      environment: null,
      pastDueAt: new Date('2026-08-10T00:00:00.000Z'),
      graceEndsAt: new Date('2026-08-17T00:00:00.000Z'),
      billingEnabled: true,
    },
  })
  await prisma.subscriptionCheckoutAttempt.create({
    data: {
      id: CANDIDATE_ATTEMPT_ID,
      businessId: CANDIDATE_BUSINESS_ID,
      subscriptionId: CANDIDATE_SUBSCRIPTION_ID,
      environment: 'sandbox',
      referenceHash: createHash('sha256').update(`${REFERENCE}-candidate`).digest('hex'),
      providerSubscriptionId: CANDIDATE_PROVIDER_SUBSCRIPTION_ID,
      providerPlanId: PROVIDER_PLAN_ID,
      planId: PLAN_ID,
      amount: 14990,
      currency: 'CLP',
      expiresAt: new Date('2026-08-15T13:00:00.000Z'),
    },
  })
})

beforeEach(async () => {
  process.env.MP_SUBSCRIPTIONS_ENABLED = 'true'
  await prisma.subscriptionPayment.deleteMany({ where: { businessId: BUSINESS_ID } })
  await prisma.subscriptionLog.deleteMany({ where: { businessId: BUSINESS_ID } })
  await prisma.subscriptionPayment.deleteMany({ where: { businessId: CANDIDATE_BUSINESS_ID } })
  await prisma.subscriptionLog.deleteMany({ where: { businessId: CANDIDATE_BUSINESS_ID } })
  await prisma.business.update({
    where: { id: BUSINESS_ID },
    data: { subscriptionStatus: 'past_due' },
  })
  await prisma.businessSubscription.update({
    where: { id: SUBSCRIPTION_ID },
    data: {
      status: 'past_due',
      planId: PLAN_ID,
      amount: 14990,
      currency: 'CLP',
      currentPeriodStart: new Date('2026-08-01T00:00:00.000Z'),
      currentPeriodEnd: new Date('2026-09-01T00:00:00.000Z'),
      lastPaidAt: null,
      nextBillingAt: null,
      pastDueAt: new Date('2026-08-10T00:00:00.000Z'),
      graceEndsAt: new Date('2026-08-17T00:00:00.000Z'),
    },
  })
  await prisma.business.update({
    where: { id: CANDIDATE_BUSINESS_ID },
    data: { subscriptionStatus: 'past_due', planId: PLAN_ID },
  })
  await prisma.businessSubscription.update({
    where: { id: CANDIDATE_SUBSCRIPTION_ID },
    data: {
      status: 'past_due',
      planId: PLAN_ID,
      amount: 14990,
      currency: 'CLP',
      provider: 'manual',
      environment: null,
      providerPlanId: null,
      providerSubscriptionId: null,
      currentPeriodStart: new Date('2026-08-01T00:00:00.000Z'),
      currentPeriodEnd: new Date('2026-09-01T00:00:00.000Z'),
      lastPaidAt: null,
      nextBillingAt: null,
      pastDueAt: new Date('2026-08-10T00:00:00.000Z'),
      graceEndsAt: new Date('2026-08-17T00:00:00.000Z'),
      billingEnabled: true,
      complimentaryUntil: null,
      cancelAtPeriodEnd: false,
      cancellationRequestedAt: null,
    },
  })
  await prisma.subscriptionCheckoutAttempt.update({
    where: { id: CANDIDATE_ATTEMPT_ID },
    data: { invalidatedAt: null },
  })
})

afterAll(async () => {
  delete process.env.MP_SUBSCRIPTIONS_ENABLED
  await cleanup()
  await concurrentPrisma.$disconnect()
  await prisma.$disconnect()
})

function candidateWebhookFixture(id: string) {
  const candidateReference = `${REFERENCE}-candidate`
  const client = {
    getInvoice: vi.fn().mockResolvedValue({
      id: `invoice-${id}`,
      subscriptionId: CANDIDATE_PROVIDER_SUBSCRIPTION_ID,
      status: 'approved',
      providerPaymentId: `payment-${id}`,
      providerStatus: 'approved',
      amount: 14990,
      currency: 'CLP',
      externalReference: candidateReference,
      approvedAt: PAID_AT,
      createdAt: PAID_AT,
      updatedAt: PAID_AT,
      debitAt: PAID_AT,
    }),
    getSubscription: vi.fn().mockResolvedValue({
      id: CANDIDATE_PROVIDER_SUBSCRIPTION_ID,
      status: 'active',
      providerStatus: 'authorized',
      collectorId: 'agendita-account-candidate',
      planId: PROVIDER_PLAN_ID,
      externalReference: candidateReference,
      checkoutUrl: null,
      amount: 14990,
      currency: 'CLP',
      frequency: 1,
      frequencyType: 'months',
      nextPaymentAt: PERIOD_END,
      updatedAt: PAID_AT,
    }),
    getCurrentAccountId: vi.fn().mockResolvedValue('agendita-account-candidate'),
    cancelSubscription: vi.fn().mockResolvedValue({
      id: CANDIDATE_PROVIDER_SUBSCRIPTION_ID,
      status: 'canceled',
    }),
  } as unknown as MpSubscriptionClient & {
    getSubscription: ReturnType<typeof vi.fn>
    cancelSubscription: ReturnType<typeof vi.fn>
  }
  return {
    client,
    dependencies: {
      prisma,
      client,
      environment: 'sandbox' as const,
      applyTransition: applySubscriptionTransition,
      adoptCandidate: adoptAuthorizedSubscriptionCandidate,
      now: () => PAID_AT,
    },
    event: {
      topic: 'subscription_authorized_payment' as const,
      resourceId: `invoice-${id}`,
      liveMode: false,
    },
  }
}

describe('processSubscriptionWebhook concurrency', () => {
  it('processes two simultaneous deliveries as one payment, period advance, and financial log', async () => {
    let arrivals = 0
    let releaseBarrier!: () => void
    const barrier = new Promise<void>((resolve) => {
      releaseBarrier = resolve
    })
    const racingPrisma = prisma.$extends({
      query: {
        subscriptionPayment: {
          async createMany({ args, query }) {
            arrivals += 1
            if (arrivals === 2) releaseBarrier()
            await barrier
            return query(args)
          },
        },
      },
    })
    const client = {
      getInvoice: vi.fn().mockResolvedValue({
        id: 'invoice-concurrent-webhook',
        subscriptionId: PROVIDER_SUBSCRIPTION_ID,
        status: 'approved',
        providerPaymentId: 'payment-concurrent-webhook',
        providerStatus: 'approved',
        amount: 14990,
        currency: 'CLP',
        externalReference: REFERENCE,
        approvedAt: PAID_AT,
        createdAt: PAID_AT,
        updatedAt: PAID_AT,
        debitAt: PAID_AT,
      }),
      getSubscription: vi.fn().mockResolvedValue({
        id: PROVIDER_SUBSCRIPTION_ID,
        status: 'active',
        providerStatus: 'authorized',
        collectorId: 'agendita-account-concurrent',
        planId: PROVIDER_PLAN_ID,
        externalReference: REFERENCE,
        checkoutUrl: null,
        amount: 14990,
        currency: 'CLP',
        frequency: 1,
        frequencyType: 'months',
        nextPaymentAt: PERIOD_END,
        updatedAt: PAID_AT,
      }),
      getCurrentAccountId: vi.fn().mockResolvedValue('agendita-account-concurrent'),
    } as unknown as MpSubscriptionClient
    const dependencies: SubscriptionWebhookDependencies = {
      prisma: racingPrisma as unknown as PrismaClient,
      client,
      environment: 'sandbox',
      applyTransition: applySubscriptionTransition,
      adoptCandidate: vi.fn(),
      now: () => PAID_AT,
    }
    const event = {
      topic: 'subscription_authorized_payment' as const,
      resourceId: 'invoice-concurrent-webhook',
      liveMode: false,
    }

    const results = await Promise.all([
      processSubscriptionWebhook(event, dependencies),
      processSubscriptionWebhook(event, dependencies),
    ])

    expect(results.map((result) => result.outcome).sort()).toEqual(['applied', 'duplicate'])
    const [subscription, paymentCount, logCount] = await Promise.all([
      concurrentPrisma.businessSubscription.findUniqueOrThrow({ where: { id: SUBSCRIPTION_ID } }),
      concurrentPrisma.subscriptionPayment.count({ where: { subscriptionId: SUBSCRIPTION_ID } }),
      concurrentPrisma.subscriptionLog.count({ where: { businessId: BUSINESS_ID } }),
    ])
    expect(subscription.currentPeriodEnd).toEqual(PERIOD_END)
    expect(paymentCount).toBe(1)
    expect(logCount).toBe(1)
  })

  it('rejects a plan/amount snapshot changed after provider fetch and before the transition transaction', async () => {
    const client = {
      getInvoice: vi.fn().mockResolvedValue({
        id: 'invoice-stale-provider-snapshot',
        subscriptionId: PROVIDER_SUBSCRIPTION_ID,
        status: 'approved',
        providerPaymentId: 'payment-stale-provider-snapshot',
        providerStatus: 'approved',
        amount: 14990,
        currency: 'CLP',
        externalReference: REFERENCE,
        approvedAt: PAID_AT,
        createdAt: PAID_AT,
        updatedAt: PAID_AT,
        debitAt: PAID_AT,
      }),
      getSubscription: vi.fn().mockResolvedValue({
        id: PROVIDER_SUBSCRIPTION_ID,
        status: 'active',
        providerStatus: 'authorized',
        collectorId: 'agendita-account-stale-snapshot',
        planId: PROVIDER_PLAN_ID,
        externalReference: REFERENCE,
        checkoutUrl: null,
        amount: 14990,
        currency: 'CLP',
        frequency: 1,
        frequencyType: 'months',
        nextPaymentAt: PERIOD_END,
        updatedAt: PAID_AT,
      }),
      getCurrentAccountId: vi.fn().mockResolvedValue('agendita-account-stale-snapshot'),
    } as unknown as MpSubscriptionClient
    let interleaved = false
    const dependencies: SubscriptionWebhookDependencies = {
      prisma,
      client,
      environment: 'sandbox',
      adoptCandidate: adoptAuthorizedSubscriptionCandidate,
      now: () => PAID_AT,
      applyTransition: async (clientPrisma, command) => {
        if (!interleaved) {
          interleaved = true
          await concurrentPrisma.businessSubscription.update({
            where: { id: SUBSCRIPTION_ID },
            data: { planId: ALT_PLAN_ID, amount: 15990 },
          })
        }
        return applySubscriptionTransition(clientPrisma, command)
      },
    }

    await expect(processSubscriptionWebhook({
      topic: 'subscription_authorized_payment',
      resourceId: 'invoice-stale-provider-snapshot',
      liveMode: false,
    }, dependencies)).rejects.toBeInstanceOf(SubscriptionWebhookValidationError)

    const [subscription, paymentCount, logCount] = await Promise.all([
      concurrentPrisma.businessSubscription.findUniqueOrThrow({ where: { id: SUBSCRIPTION_ID } }),
      concurrentPrisma.subscriptionPayment.count({ where: { subscriptionId: SUBSCRIPTION_ID } }),
      concurrentPrisma.subscriptionLog.count({ where: { businessId: BUSINESS_ID } }),
    ])
    expect(subscription).toMatchObject({
      planId: ALT_PLAN_ID,
      amount: 15990,
      currentPeriodEnd: new Date('2026-09-01T00:00:00.000Z'),
      lastPaidAt: null,
    })
    expect(paymentCount).toBe(0)
    expect(logCount).toBe(0)
  })

  it('settles an authorized candidate once after the global creation flag is turned off', async () => {
    process.env.MP_SUBSCRIPTIONS_ENABLED = 'false'
    const { dependencies, event } = candidateWebhookFixture('candidate-flag-off')

    const first = await processSubscriptionWebhook(event, dependencies)
    const duplicate = await processSubscriptionWebhook(event, dependencies)

    expect([first.outcome, duplicate.outcome]).toEqual(['applied', 'duplicate'])
    const [subscription, attempt, paymentCount, logs] = await Promise.all([
      prisma.businessSubscription.findUniqueOrThrow({ where: { id: CANDIDATE_SUBSCRIPTION_ID } }),
      prisma.subscriptionCheckoutAttempt.findUniqueOrThrow({ where: { id: CANDIDATE_ATTEMPT_ID } }),
      prisma.subscriptionPayment.count({ where: { subscriptionId: CANDIDATE_SUBSCRIPTION_ID } }),
      prisma.subscriptionLog.findMany({ where: { businessId: CANDIDATE_BUSINESS_ID } }),
    ])
    expect(subscription).toMatchObject({
      provider: 'mercado_pago',
      environment: 'sandbox',
      providerSubscriptionId: CANDIDATE_PROVIDER_SUBSCRIPTION_ID,
      status: 'active',
      currentPeriodEnd: PERIOD_END,
    })
    expect(attempt.invalidatedAt).toEqual(PAID_AT)
    expect(paymentCount).toBe(1)
    expect(logs.filter((log) => log.action === 'provider_subscription_authorized')).toHaveLength(1)
    expect(logs.filter((log) => log.action === 'subscription_recovered')).toHaveLength(1)
  })

  it.each([
    ['billing disabled', { billingEnabled: false }],
    ['complimentary exemption added', { complimentaryUntil: new Date('2026-09-01T00:00:00.000Z') }],
  ])('settles a paid period once and disables renewals when %s after checkout', async (_name, patch) => {
    await prisma.businessSubscription.update({
      where: { id: CANDIDATE_SUBSCRIPTION_ID },
      data: patch,
    })
    const { client, dependencies, event } = candidateWebhookFixture(
      `eligibility-${_name.replaceAll(' ', '-')}`,
    )

    const first = await processSubscriptionWebhook(event, dependencies)
    const duplicate = await processSubscriptionWebhook(event, dependencies)

    expect([first.outcome, duplicate.outcome]).toEqual(['applied', 'duplicate'])
    const [subscription, paymentCount, logs] = await Promise.all([
      prisma.businessSubscription.findUniqueOrThrow({ where: { id: CANDIDATE_SUBSCRIPTION_ID } }),
      prisma.subscriptionPayment.count({ where: { subscriptionId: CANDIDATE_SUBSCRIPTION_ID } }),
      prisma.subscriptionLog.findMany({ where: { businessId: CANDIDATE_BUSINESS_ID } }),
    ])
    expect(subscription).toMatchObject({
      provider: 'mercado_pago',
      providerSubscriptionId: CANDIDATE_PROVIDER_SUBSCRIPTION_ID,
      status: 'active',
      currentPeriodEnd: PERIOD_END,
      cancelAtPeriodEnd: true,
      cancellationRequestedAt: PAID_AT,
    })
    expect(paymentCount).toBe(1)
    expect(logs.filter((log) => log.action === 'subscription_recovered')).toHaveLength(1)
    expect(client.cancelSubscription).toHaveBeenCalledTimes(2)
  })

  it('keeps settlement durable and retries future-renewal cancellation after a network failure', async () => {
    await prisma.businessSubscription.update({
      where: { id: CANDIDATE_SUBSCRIPTION_ID },
      data: { billingEnabled: false },
    })
    const { client, dependencies, event } = candidateWebhookFixture('cancel-retry')
    client.cancelSubscription
      .mockRejectedValueOnce(new MercadoPagoSubscriptionTransportError())
      .mockResolvedValueOnce({ id: CANDIDATE_PROVIDER_SUBSCRIPTION_ID, status: 'canceled' })

    await expect(processSubscriptionWebhook(event, dependencies))
      .rejects.toBeInstanceOf(MercadoPagoSubscriptionTransportError)

    await expect(prisma.businessSubscription.findUniqueOrThrow({
      where: { id: CANDIDATE_SUBSCRIPTION_ID },
    })).resolves.toMatchObject({
      status: 'active',
      currentPeriodEnd: PERIOD_END,
      cancelAtPeriodEnd: true,
    })
    await expect(prisma.subscriptionPayment.count({
      where: { subscriptionId: CANDIDATE_SUBSCRIPTION_ID },
    })).resolves.toBe(1)

    await expect(processSubscriptionWebhook(event, dependencies)).resolves.toMatchObject({
      outcome: 'duplicate',
      status: 'active',
    })
    await expect(prisma.subscriptionPayment.count({
      where: { subscriptionId: CANDIDATE_SUBSCRIPTION_ID },
    })).resolves.toBe(1)
    await expect(prisma.subscriptionLog.count({
      where: { businessId: CANDIDATE_BUSINESS_ID },
    })).resolves.toBe(1)
    expect(client.cancelSubscription).toHaveBeenCalledTimes(2)
  })

  it('returns duplicate when remote cancellation succeeded but its response was lost', async () => {
    await prisma.businessSubscription.update({
      where: { id: CANDIDATE_SUBSCRIPTION_ID },
      data: { billingEnabled: false },
    })
    const { client, dependencies, event } = candidateWebhookFixture('cancel-applied-timeout')
    client.cancelSubscription.mockRejectedValueOnce(new MercadoPagoSubscriptionTransportError())

    await expect(processSubscriptionWebhook(event, dependencies))
      .rejects.toBeInstanceOf(MercadoPagoSubscriptionTransportError)

    client.getSubscription.mockResolvedValue({
      id: CANDIDATE_PROVIDER_SUBSCRIPTION_ID,
      status: 'canceled',
      providerStatus: 'canceled',
      collectorId: 'agendita-account-candidate',
      planId: PROVIDER_PLAN_ID,
      externalReference: `${REFERENCE}-candidate`,
      checkoutUrl: null,
      amount: 14990,
      currency: 'CLP',
      frequency: 1,
      frequencyType: 'months',
      nextPaymentAt: null,
      updatedAt: PAID_AT,
    })

    await expect(processSubscriptionWebhook(event, dependencies)).resolves.toEqual({
      outcome: 'duplicate',
      status: 'active',
    })

    const [subscription, paymentCount, logCount] = await Promise.all([
      prisma.businessSubscription.findUniqueOrThrow({ where: { id: CANDIDATE_SUBSCRIPTION_ID } }),
      prisma.subscriptionPayment.count({ where: { subscriptionId: CANDIDATE_SUBSCRIPTION_ID } }),
      prisma.subscriptionLog.count({ where: { businessId: CANDIDATE_BUSINESS_ID } }),
    ])
    expect(subscription).toMatchObject({
      status: 'active',
      currentPeriodEnd: PERIOD_END,
      cancelAtPeriodEnd: true,
    })
    expect(paymentCount).toBe(1)
    expect(logCount).toBe(1)
    expect(client.cancelSubscription).toHaveBeenCalledTimes(1)
  })
})
