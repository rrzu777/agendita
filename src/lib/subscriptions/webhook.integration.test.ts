import { createHash } from 'node:crypto'
import { PrismaClient } from '@prisma/client'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { prisma } from '@/lib/db'
import { requireTestDatabase } from '../../../tests/integration/setup'
import type { MpSubscriptionClient } from './mercado-pago-client'
import { applySubscriptionTransition } from './transition'
import { processSubscriptionWebhook, type SubscriptionWebhookDependencies } from './webhook'

requireTestDatabase()

const PLAN_ID = 'subscription-webhook-plan'
const BUSINESS_ID = 'subscription-webhook-business'
const SUBSCRIPTION_ID = 'subscription-webhook-subscription'
const ATTEMPT_ID = 'subscription-webhook-attempt'
const PROVIDER_SUBSCRIPTION_ID = 'provider-subscription-webhook'
const PROVIDER_PLAN_ID = 'provider-plan-webhook'
const REFERENCE = 'subscription-webhook-reference'
const PAID_AT = new Date('2026-08-15T12:00:00.000Z')
const PERIOD_END = new Date('2026-10-01T00:00:00.000Z')
const concurrentPrisma = new PrismaClient()

async function cleanup() {
  await prisma.subscriptionPayment.deleteMany({ where: { businessId: BUSINESS_ID } })
  await prisma.subscriptionLog.deleteMany({ where: { businessId: BUSINESS_ID } })
  await prisma.subscriptionCheckoutAttempt.deleteMany({ where: { businessId: BUSINESS_ID } })
  await prisma.businessSubscription.deleteMany({ where: { businessId: BUSINESS_ID } })
  await prisma.business.deleteMany({ where: { id: BUSINESS_ID } })
  await prisma.plan.deleteMany({ where: { id: PLAN_ID } })
}

beforeAll(async () => {
  await cleanup()
  await prisma.plan.create({
    data: { id: PLAN_ID, name: 'Webhook plan', priceMonthly: 14990, priceYearly: 149900 },
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
})

afterAll(async () => {
  await cleanup()
  await concurrentPrisma.$disconnect()
  await prisma.$disconnect()
})

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
})
