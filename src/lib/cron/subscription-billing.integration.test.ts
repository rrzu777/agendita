import { createHash } from 'node:crypto'
import type { PrismaClient } from '@prisma/client'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { prisma } from '@/lib/db'
import { requireTestDatabase } from '../../../tests/integration/setup'
import type { MpSubscriptionClient } from '@/lib/subscriptions/mercado-pago-client'
import type { MpSubscription } from '@/lib/subscriptions/mercado-pago-mappers'
import {
  reconcileSubscription,
  type ReconciliationDependencies,
} from '@/lib/subscriptions/reconciliation'
import {
  applySubscriptionTransition,
  type ApplySubscriptionTransitionCommand,
} from '@/lib/subscriptions/transition'
import {
  processSubscriptionWebhook,
  type SubscriptionWebhookDependencies,
} from '@/lib/subscriptions/webhook'
import {
  runSubscriptionBillingCron,
  type SubscriptionBillingCronDependencies,
} from './subscription-billing'
import { retrySubscriptionNotifications, sendSubscriptionNotification } from '@/lib/notifications/subscriptions'

requireTestDatabase()

const PLAN_ID = 'billing-race-plan'
const ALT_PLAN_ID = 'billing-race-alt-plan'
const BUSINESS_ID = 'billing-race-business'
const SUBSCRIPTION_ID = 'billing-race-subscription'
const ATTEMPT_ID = 'billing-race-attempt'
const PROVIDER_SUBSCRIPTION_ID = 'billing-race-provider-subscription'
const PROVIDER_PLAN_ID = 'billing-race-provider-plan'
const REFERENCE = 'billing-race-reference'
const NOW = new Date('2026-08-11T12:00:00.000Z')

async function cleanup() {
  await prisma.subscriptionLog.deleteMany({ where: { businessId: BUSINESS_ID } })
  await prisma.subscriptionPayment.deleteMany({ where: { businessId: BUSINESS_ID } })
  await prisma.subscriptionCheckoutAttempt.deleteMany({ where: { businessId: BUSINESS_ID } })
  await prisma.businessSubscription.deleteMany({ where: { businessId: BUSINESS_ID } })
  await prisma.business.deleteMany({ where: { id: BUSINESS_ID } })
  await prisma.plan.deleteMany({ where: { id: { in: [PLAN_ID, ALT_PLAN_ID] } } })
}

async function resetFixture() {
  await cleanup()
  await prisma.plan.create({
    data: { id: PLAN_ID, name: PLAN_ID, priceMonthly: 15_000, priceYearly: 150_000 },
  })
  await prisma.plan.create({
    data: { id: ALT_PLAN_ID, name: ALT_PLAN_ID, priceMonthly: 20_000, priceYearly: 200_000 },
  })
  await prisma.business.create({
    data: {
      id: BUSINESS_ID,
      name: 'Billing Race Business',
      slug: BUSINESS_ID,
      subdomain: BUSINESS_ID,
      ownerUserId: 'billing-race-owner',
      city: 'Santiago',
      planId: PLAN_ID,
      subscriptionStatus: 'active',
    },
  })
  await prisma.businessSubscription.create({
    data: {
      id: SUBSCRIPTION_ID,
      businessId: BUSINESS_ID,
      planId: PLAN_ID,
      status: 'active',
      interval: 'monthly',
      currentPeriodStart: new Date('2026-07-11T12:00:00.000Z'),
      currentPeriodEnd: NOW,
      amount: 15_000,
      currency: 'CLP',
      provider: 'mercado_pago',
      environment: 'sandbox',
      providerPlanId: PROVIDER_PLAN_ID,
      providerSubscriptionId: PROVIDER_SUBSCRIPTION_ID,
      nextBillingAt: NOW,
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
      amount: 15_000,
      currency: 'CLP',
      expiresAt: new Date('2026-08-11T13:00:00.000Z'),
      invalidatedAt: NOW,
    },
  })
}

beforeAll(resetFixture)
beforeEach(resetFixture)
afterAll(async () => {
  await cleanup()
  await prisma.$disconnect()
})

describe('subscription billing cancellation interleaving', () => {
  it('no reutiliza evidencia terminal MP si cambia el provider ID antes de la transición', async () => {
    await prisma.businessSubscription.update({
      where: { id: SUBSCRIPTION_ID },
      data: {
        cancelAtPeriodEnd: true,
        cancellationRequestedAt: new Date('2026-08-11T11:00:00.000Z'),
      },
    })
    const replacementProviderId = 'billing-race-provider-replacement'
    let replaced = false
    const applyAfterProviderReplacement = vi.fn(async (
      db: PrismaClient,
      input: ApplySubscriptionTransitionCommand,
    ) => {
      if (!replaced) {
        replaced = true
        await db.businessSubscription.update({
          where: { id: SUBSCRIPTION_ID },
          data: { providerSubscriptionId: replacementProviderId },
        })
      }
      return applySubscriptionTransition(db, input)
    })
    const dependencies = {
      prisma,
      reconcile: vi.fn().mockResolvedValue({
        outcome: 'reconciled',
        invoices: 0,
        applied: 0,
        providerTerminalCanceled: true,
      }),
      applyTransition: applyAfterProviderReplacement,
      enforcementEnabled: () => true,
      recordError: vi.fn(),
    } as SubscriptionBillingCronDependencies

    await expect(runSubscriptionBillingCron({ now: NOW }, dependencies))
      .resolves.toMatchObject({ processed: 1, reconciled: 1, errors: 1 })
    await expect(prisma.businessSubscription.findUnique({
      where: { id: SUBSCRIPTION_ID },
      select: { status: true, providerSubscriptionId: true },
    })).resolves.toEqual({
      status: 'active',
      providerSubscriptionId: replacementProviderId,
    })
  })

  it('no usa evidencia manual obsoleta si MP se adopta antes de la transición', async () => {
    await prisma.businessSubscription.update({
      where: { id: SUBSCRIPTION_ID },
      data: {
        provider: 'manual',
        environment: null,
        providerPlanId: null,
        providerSubscriptionId: null,
        cancelAtPeriodEnd: true,
        cancellationRequestedAt: new Date('2026-08-11T11:00:00.000Z'),
      },
    })
    let adopted = false
    const applyWithConcurrentAdoption = vi.fn(async (
      db: PrismaClient,
      input: ApplySubscriptionTransitionCommand,
    ) => {
      if (!adopted) {
        adopted = true
        await db.businessSubscription.update({
          where: { id: SUBSCRIPTION_ID },
          data: {
            provider: 'mercado_pago',
            environment: 'sandbox',
            providerPlanId: PROVIDER_PLAN_ID,
            providerSubscriptionId: PROVIDER_SUBSCRIPTION_ID,
          },
        })
      }
      return applySubscriptionTransition(db, input)
    })
    const reconciliation = vi.fn()
    const dependencies = {
      prisma,
      reconcile: reconciliation,
      applyTransition: applyWithConcurrentAdoption,
      enforcementEnabled: () => true,
      recordError: vi.fn(),
    } as SubscriptionBillingCronDependencies

    await expect(runSubscriptionBillingCron({ now: NOW }, dependencies))
      .resolves.toMatchObject({ processed: 1, reconciled: 0, errors: 0 })
    expect(reconciliation).not.toHaveBeenCalled()
    await expect(prisma.businessSubscription.findUnique({
      where: { id: SUBSCRIPTION_ID },
      select: { status: true, provider: true, providerSubscriptionId: true },
    })).resolves.toEqual({
      status: 'active',
      provider: 'mercado_pago',
      providerSubscriptionId: PROVIDER_SUBSCRIPTION_ID,
    })
  })

  it('rechaza una identidad financiera cambiada después del GET remoto', async () => {
    let releaseSearch!: () => void
    let observeGet!: () => void
    const getObserved = new Promise<void>((resolve) => { observeGet = resolve })
    const searchPending = new Promise<void>((resolve) => { releaseSearch = resolve })
    const candidate: MpSubscription = {
      id: PROVIDER_SUBSCRIPTION_ID,
      status: 'active',
      providerStatus: 'authorized',
      collectorId: 'billing-race-account',
      planId: PROVIDER_PLAN_ID,
      externalReference: REFERENCE,
      checkoutUrl: null,
      amount: 15_000,
      currency: 'CLP',
      frequency: 1,
      frequencyType: 'months',
      nextPaymentAt: new Date('2026-09-11T12:00:00.000Z'),
      updatedAt: NOW,
    }
    const client = {
      getSubscription: vi.fn(async () => {
        observeGet()
        return candidate
      }),
      searchInvoices: vi.fn(async () => {
        await searchPending
        return []
      }),
      getCurrentAccountId: vi.fn().mockResolvedValue('billing-race-account'),
      cancelSubscription: vi.fn(),
    }
    const reconciliationDependencies: ReconciliationDependencies = {
      prisma,
      getProcessor: () => ({
        client,
        process: vi.fn().mockResolvedValue({ outcome: 'applied', status: 'active' }),
      }),
      now: () => NOW,
    }
    const cronTransition = vi.fn(applySubscriptionTransition)
    const cronDependencies: SubscriptionBillingCronDependencies = {
      prisma,
      reconcile: (id) => reconcileSubscription(id, reconciliationDependencies),
      applyTransition: cronTransition,
      enforcementEnabled: () => true,
      recordError: vi.fn(),
    }

    const run = runSubscriptionBillingCron({ now: NOW }, cronDependencies)
    await getObserved
    await applySubscriptionTransition(prisma, {
      subscriptionId: SUBSCRIPTION_ID,
      command: { type: 'admin_change_plan', planId: ALT_PLAN_ID },
    })
    releaseSearch()

    await expect(run).resolves.toMatchObject({ reconciled: 0, errors: 1 })
    expect(cronTransition).not.toHaveBeenCalled()
    await expect(prisma.businessSubscription.findUnique({
      where: { id: SUBSCRIPTION_ID },
      select: { planId: true, lastReconciledAt: true, status: true },
    })).resolves.toEqual({
      planId: ALT_PLAN_ID,
      lastReconciledAt: null,
      status: 'active',
    })
  })

  it('observa el intent concurrente, cancela remoto una vez y recién luego cancela local', async () => {
    let providerSnapshot: MpSubscription = {
      id: PROVIDER_SUBSCRIPTION_ID,
      status: 'active',
      providerStatus: 'authorized',
      collectorId: 'billing-race-account',
      planId: PROVIDER_PLAN_ID,
      externalReference: REFERENCE,
      checkoutUrl: null,
      amount: 15_000,
      currency: 'CLP',
      frequency: 1,
      frequencyType: 'months',
      nextPaymentAt: new Date('2026-09-11T12:00:00.000Z'),
      updatedAt: NOW,
    }
    let releaseFirstSearch!: () => void
    let observeFirstGet!: () => void
    const firstGetObserved = new Promise<void>((resolve) => { observeFirstGet = resolve })
    const firstSearchPending = new Promise<void>((resolve) => { releaseFirstSearch = resolve })
    let blockFirstSearch = true
    const cancelSubscription = vi.fn(async () => {
      providerSnapshot = {
        ...providerSnapshot,
        status: 'canceled',
        providerStatus: 'canceled',
        nextPaymentAt: null,
        updatedAt: new Date('2026-08-11T12:01:00.000Z'),
      }
      return providerSnapshot
    })
    const client = {
      getSubscription: vi.fn(async () => {
        observeFirstGet()
        return providerSnapshot
      }),
      searchInvoices: vi.fn(async () => {
        if (blockFirstSearch) {
          blockFirstSearch = false
          await firstSearchPending
        }
        return []
      }),
      getCurrentAccountId: vi.fn().mockResolvedValue('billing-race-account'),
      cancelSubscription,
      getInvoice: vi.fn(),
      createPlan: vi.fn(),
      getPlan: vi.fn(),
      createSubscription: vi.fn(),
    } as unknown as MpSubscriptionClient
    const webhookDependencies: SubscriptionWebhookDependencies = {
      prisma,
      client,
      environment: 'sandbox',
      applyTransition: applySubscriptionTransition,
      adoptCandidate: vi.fn(),
      now: () => NOW,
    }
    const reconciliationDependencies: ReconciliationDependencies = {
      prisma,
      getProcessor: () => ({
        client,
        process: (event) => processSubscriptionWebhook(event, webhookDependencies),
      }),
      now: () => NOW,
    }
    const cronDependencies: SubscriptionBillingCronDependencies = {
      prisma,
      reconcile: (id) => reconcileSubscription(id, reconciliationDependencies),
      applyTransition: applySubscriptionTransition,
      enforcementEnabled: () => true,
      recordError: vi.fn(),
    }

    const firstRun = runSubscriptionBillingCron({ now: NOW }, cronDependencies)
    await firstGetObserved
    await applySubscriptionTransition(prisma, {
      subscriptionId: SUBSCRIPTION_ID,
      command: { type: 'admin_cancel', occurredAt: new Date('2026-08-11T12:00:30.000Z') },
    })
    releaseFirstSearch()

    await expect(firstRun).resolves.toMatchObject({ reconciled: 0, errors: 1 })
    expect(cancelSubscription).not.toHaveBeenCalled()
    await expect(prisma.businessSubscription.findUnique({
      where: { id: SUBSCRIPTION_ID },
      select: { status: true, cancelAtPeriodEnd: true, lastReconciledAt: true },
    })).resolves.toEqual({
      status: 'active',
      cancelAtPeriodEnd: true,
      lastReconciledAt: null,
    })

    await expect(runSubscriptionBillingCron({ now: NOW }, cronDependencies))
      .resolves.toMatchObject({ reconciled: 0, errors: 1 })
    expect(cancelSubscription).toHaveBeenCalledTimes(1)
    await expect(prisma.businessSubscription.findUnique({
      where: { id: SUBSCRIPTION_ID },
      select: { status: true, lastReconciledAt: true },
    })).resolves.toEqual({ status: 'active', lastReconciledAt: null })

    await expect(runSubscriptionBillingCron({ now: NOW }, cronDependencies))
      .resolves.toMatchObject({ reconciled: 1, errors: 0 })
    expect(cancelSubscription).toHaveBeenCalledTimes(1)
    await expect(prisma.businessSubscription.findUnique({
      where: { id: SUBSCRIPTION_ID },
      select: { status: true, cancelAtPeriodEnd: true, lastReconciledAt: true },
    })).resolves.toMatchObject({
      status: 'cancelled',
      cancelAtPeriodEnd: true,
      lastReconciledAt: NOW,
    })
    expect(providerSnapshot.status).toBe('canceled')
  })

  it('does not claim or effect a subscription disabled before selection', async () => {
    await prisma.businessSubscription.update({
      where: { id: SUBSCRIPTION_ID },
      data: { billingEnabled: false },
    })
    const reconcile = vi.fn()
    const applyTransition = vi.fn()
    const send = vi.fn()
    await expect(runSubscriptionBillingCron({ now: NOW }, {
      prisma, reconcile, applyTransition, enforcementEnabled: () => true,
      retrySubscriptionNotifications: vi.fn().mockResolvedValue([]),
      queueSubscriptionNotification: vi.fn(), sendSubscriptionNotification: send,
    })).resolves.toMatchObject({ processed: 0, reconciled: 0, notified: 0, suspended: 0 })
    expect(reconcile).not.toHaveBeenCalled()
    expect(applyTransition).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
  })

  it('revalidates billing enrollment after claim before provider or local effects', async () => {
    const businessSubscription = {
      findMany: prisma.businessSubscription.findMany.bind(prisma.businessSubscription),
      updateMany: prisma.businessSubscription.updateMany.bind(prisma.businessSubscription),
      findUnique: prisma.businessSubscription.findUnique.bind(prisma.businessSubscription),
      findFirst: vi.fn(async (args: Parameters<typeof prisma.businessSubscription.findFirst>[0]) => {
        await prisma.businessSubscription.update({
          where: { id: SUBSCRIPTION_ID },
          data: { billingEnabled: false },
        })
        return prisma.businessSubscription.findFirst(args)
      }),
    }
    const reconcile = vi.fn()
    const applyTransition = vi.fn()
    const send = vi.fn()
    await expect(runSubscriptionBillingCron({ now: NOW }, {
      prisma: { businessSubscription } as unknown as PrismaClient,
      reconcile, applyTransition, enforcementEnabled: () => true,
      retrySubscriptionNotifications: vi.fn().mockResolvedValue([]),
      queueSubscriptionNotification: vi.fn(), sendSubscriptionNotification: send,
    })).resolves.toMatchObject({ processed: 1, reconciled: 0, notified: 0, suspended: 0 })
    expect(reconcile).not.toHaveBeenCalled()
    expect(applyTransition).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
  })

  it('terminalizes a scheduled outbox retry disabled before delivery', async () => {
    await prisma.subscriptionNotificationDelivery.create({ data: {
      businessId: BUSINESS_ID,
      subscriptionId: SUBSCRIPTION_ID,
      kind: 'subscription_due_1_day',
      effectiveDate: NOW,
      eventAt: NOW,
      availableAt: NOW,
      dedupeKey: 'billing-disabled-pending-notice',
      status: 'failed',
      nextAttemptAt: NOW,
      recipientEmails: ['owner@example.test'],
      businessNameSnapshot: 'Billing Race Business',
    } })
    await prisma.businessSubscription.update({
      where: { id: SUBSCRIPTION_ID }, data: { billingEnabled: false },
    })
    const sendEmail = vi.fn()
    await expect(retrySubscriptionNotifications({ now: NOW }, {
      prisma, sendEmail, now: () => NOW,
    })).resolves.toEqual([])
    await expect(prisma.subscriptionNotificationDelivery.findUniqueOrThrow({
      where: { dedupeKey: 'billing-disabled-pending-notice' },
      select: { status: true, nextAttemptAt: true, lastErrorCode: true },
    })).resolves.toEqual({ status: 'suppressed', nextAttemptAt: null, lastErrorCode: 'billing_disabled' })
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('holds the billing lease through scheduled email and permits disable only after release', async () => {
    const effectiveDate = new Date(NOW.getTime() + 7 * 86_400_000)
    await prisma.subscriptionNotificationDelivery.create({ data: {
      businessId: BUSINESS_ID, subscriptionId: SUBSCRIPTION_ID,
      kind: 'subscription_due_7_days', effectiveDate, eventAt: NOW,
      availableAt: NOW,
      dedupeKey: `${SUBSCRIPTION_ID}:subscription_due_7_days:${effectiveDate.toISOString()}`,
      status: 'pending', nextAttemptAt: NOW,
      recipientEmails: ['owner@example.test'], businessNameSnapshot: 'Billing Race Business',
    } })
    let releaseEmail!: () => void
    let emailStarted!: () => void
    const started = new Promise<void>((resolve) => { emailStarted = resolve })
    const blocked = new Promise<void>((resolve) => { releaseEmail = resolve })
    const sendEmail = vi.fn(async () => {
      emailStarted()
      await blocked
      return { success: true as const }
    })
    const send = sendSubscriptionNotification('subscription_due_7_days', {
      businessId: BUSINESS_ID, subscriptionId: SUBSCRIPTION_ID,
      effectiveDate,
    }, { prisma, sendEmail, now: () => NOW })
    await started

    const disableWhileClaimed = await prisma.businessSubscription.updateMany({
      where: {
        id: SUBSCRIPTION_ID,
        OR: [{ billingCronClaimedUntil: null }, { billingCronClaimedUntil: { lte: NOW } }],
      },
      data: { billingEnabled: false },
    })
    expect(disableWhileClaimed.count).toBe(0)

    releaseEmail()
    await expect(send).resolves.toEqual({ status: 'sent' })
    const disableAfterRelease = await prisma.businessSubscription.updateMany({
      where: {
        id: SUBSCRIPTION_ID,
        OR: [{ billingCronClaimedUntil: null }, { billingCronClaimedUntil: { lte: NOW } }],
      },
      data: { billingEnabled: false },
    })
    expect(disableAfterRelease.count).toBe(1)
    expect(sendEmail).toHaveBeenCalledTimes(1)
  })

  it('recovers an expired billing lease for a scheduled retry', async () => {
    const effectiveDate = new Date(NOW.getTime() + 3 * 86_400_000)
    await prisma.businessSubscription.update({
      where: { id: SUBSCRIPTION_ID },
      data: { billingCronClaimedUntil: new Date(NOW.getTime() - 1) },
    })
    await prisma.subscriptionNotificationDelivery.create({ data: {
      businessId: BUSINESS_ID, subscriptionId: SUBSCRIPTION_ID,
      kind: 'subscription_due_3_days', effectiveDate, eventAt: NOW,
      availableAt: NOW,
      dedupeKey: `${SUBSCRIPTION_ID}:subscription_due_3_days:${effectiveDate.toISOString()}`,
      status: 'failed', nextAttemptAt: NOW,
      recipientEmails: ['owner@example.test'], businessNameSnapshot: 'Billing Race Business',
    } })
    const sendEmail = vi.fn().mockResolvedValue({ success: true })
    await expect(sendSubscriptionNotification('subscription_due_3_days', {
      businessId: BUSINESS_ID, subscriptionId: SUBSCRIPTION_ID,
      effectiveDate,
    }, { prisma, sendEmail, now: () => NOW })).resolves.toEqual({ status: 'sent' })
    await expect(prisma.businessSubscription.findUniqueOrThrow({
      where: { id: SUBSCRIPTION_ID }, select: { billingCronClaimedUntil: true },
    })).resolves.toEqual({ billingCronClaimedUntil: null })
  })
})
