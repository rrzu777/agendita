import { Prisma, type PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db'
import { getSubscriptionEnforcementEnabled } from '@/lib/env'
import { logger } from '@/lib/logger'
import {
  retrySubscriptionNotifications,
  queueSubscriptionNotification,
  sendSubscriptionNotification,
  type SubscriptionNotificationData,
  type SubscriptionNotificationKind,
  type SubscriptionNotificationResult,
} from '@/lib/notifications/subscriptions'
import {
  reconcileSubscription,
  type SubscriptionReconciliationResult,
} from '@/lib/subscriptions/reconciliation'
import {
  applySubscriptionTransition,
  type ApplySubscriptionTransitionCommand,
} from '@/lib/subscriptions/transition'

const DAY_IN_MS = 24 * 60 * 60 * 1000
const PAGE_SIZE = 5
const CONCURRENCY = 5
const LEASE_MS = 5 * 60 * 1000

const subscriptionSelect = {
  id: true,
  businessId: true,
  status: true,
  interval: true,
  currentPeriodStart: true,
  currentPeriodEnd: true,
  trialStartAt: true,
  trialEndAt: true,
  trialDays: true,
  cancelledAt: true,
  suspendedAt: true,
  suspendedReason: true,
  nextBillingAt: true,
  lastPaidAt: true,
  pastDueAt: true,
  graceEndsAt: true,
  graceDays: true,
  graceEnforcementDeferredAt: true,
  cancelAtPeriodEnd: true,
  cancellationRequestedAt: true,
  complimentaryUntil: true,
  provider: true,
  environment: true,
  providerSubscriptionId: true,
  lastReconciledAt: true,
  billingCronClaimedUntil: true,
  billingEnabled: true,
  updatedAt: true,
} satisfies Prisma.BusinessSubscriptionSelect

type CronSubscription = Prisma.BusinessSubscriptionGetPayload<{
  select: typeof subscriptionSelect
}>

export type SubscriptionBillingCronResult = {
  processed: number
  reconciled: number
  notified: number
  suspended: number
  errors: number
}

export type SubscriptionBillingCronDependencies = {
  prisma: PrismaClient
  reconcile(id: string): Promise<SubscriptionReconciliationResult>
  applyTransition(
    prisma: PrismaClient,
    input: ApplySubscriptionTransitionCommand,
  ): Promise<{ applied: boolean; status: string }>
  enforcementEnabled(): boolean
  sendSubscriptionNotification?(
    kind: SubscriptionNotificationKind,
    data: SubscriptionNotificationData,
  ): Promise<SubscriptionNotificationResult>
  retrySubscriptionNotifications?(input: { now: Date }): Promise<SubscriptionNotificationResult[]>
  queueSubscriptionNotification?(
    kind: SubscriptionNotificationKind,
    data: SubscriptionNotificationData,
  ): Promise<void>
  recordError?(): void
}

function runtimeDependencies(): SubscriptionBillingCronDependencies {
  return {
    prisma,
    reconcile: (id) => reconcileSubscription(id),
    applyTransition: applySubscriptionTransition,
    enforcementEnabled: getSubscriptionEnforcementEnabled,
    sendSubscriptionNotification,
    retrySubscriptionNotifications,
    queueSubscriptionNotification,
    recordError: () => logger.error(
      'subscription_billing_cron.item_failed',
      'Subscription billing cron item failed.',
    ),
  }
}

function dueNotification(subscription: CronSubscription, now: Date): (SubscriptionNotificationData & {
  kind: SubscriptionNotificationKind
  dedupeKey: string
}) | null {
  if (subscription.cancelAtPeriodEnd) return null
  const effectiveDate = subscription.complimentaryUntil &&
    subscription.complimentaryUntil.getTime() > now.getTime()
    ? subscription.complimentaryUntil
    : subscription.status === 'trialing'
      ? subscription.trialEndAt
    : subscription.status === 'active'
      ? subscription.nextBillingAt
      : null
  if (!effectiveDate) return null

  const remaining = effectiveDate.getTime() - now.getTime()
  if (remaining <= 0) return null
  const days = Math.ceil(remaining / DAY_IN_MS)
  if (days !== 7 && days !== 3 && days !== 1) return null
  const kind: SubscriptionNotificationKind = days === 1
    ? 'subscription_due_1_day'
    : days === 3
      ? 'subscription_due_3_days'
      : 'subscription_due_7_days'
  return {
    businessId: subscription.businessId,
    subscriptionId: subscription.id,
    kind,
    effectiveDate,
    dedupeKey: `${subscription.id}:${kind}:${effectiveDate.toISOString()}`,
  }
}

async function claimSubscription(
  dependencies: SubscriptionBillingCronDependencies,
  subscription: CronSubscription,
  now: Date,
): Promise<Date | null> {
  const leaseUntil = new Date(now.getTime() + LEASE_MS)
  const claim = await dependencies.prisma.businessSubscription.updateMany({
    where: {
      id: subscription.id,
      status: subscription.status,
      updatedAt: subscription.updatedAt,
      billingCronClaimedUntil: subscription.billingCronClaimedUntil,
      billingEnabled: true,
      OR: [
        { billingCronClaimedUntil: null },
        { billingCronClaimedUntil: { lte: now } },
      ],
    },
    data: { billingCronClaimedUntil: leaseUntil },
  })
  return claim.count === 1 ? leaseUntil : null
}

async function releaseClaim(
  dependencies: SubscriptionBillingCronDependencies,
  subscriptionId: string,
  leaseUntil: Date,
) {
  await dependencies.prisma.businessSubscription.updateMany({
    where: { id: subscriptionId, billingCronClaimedUntil: leaseUntil },
    data: { billingCronClaimedUntil: null },
  })
}

async function processClaimedSubscription(input: {
  dependencies: SubscriptionBillingCronDependencies
  candidate: CronSubscription
  leaseUntil: Date
  now: Date
  enforcementEnabled: boolean
  result: SubscriptionBillingCronResult
}) {
  const { dependencies, candidate, leaseUntil, now, enforcementEnabled, result } = input
  let current = candidate
  let providerCancellationConfirmed = false
  let expectedCancellationProviderSnapshot:
    ApplySubscriptionTransitionCommand['expectedCancellationProviderSnapshot']
  try {
    const enrolled = await dependencies.prisma.businessSubscription.findFirst({
      where: { id: candidate.id, billingEnabled: true, billingCronClaimedUntil: leaseUntil },
      select: subscriptionSelect,
    })
    if (!enrolled) return
    current = enrolled
    if (
      candidate.provider === 'mercado_pago' &&
      candidate.environment &&
      candidate.providerSubscriptionId
    ) {
      try {
        const reconciliation = await dependencies.reconcile(candidate.id)
        result.reconciled++
        const refreshed = await dependencies.prisma.businessSubscription.findUnique({
          where: { id: candidate.id },
          select: subscriptionSelect,
        })
        if (!refreshed) throw new Error('Subscription disappeared during reconciliation.')
        current = refreshed
        providerCancellationConfirmed = reconciliation.providerTerminalCanceled &&
          refreshed.provider === candidate.provider &&
          refreshed.environment === candidate.environment &&
          refreshed.providerSubscriptionId === candidate.providerSubscriptionId
        if (
          providerCancellationConfirmed &&
          refreshed.provider === 'mercado_pago' &&
          refreshed.environment &&
          refreshed.providerSubscriptionId
        ) {
          expectedCancellationProviderSnapshot = {
            provider: refreshed.provider,
            environment: refreshed.environment,
            providerSubscriptionId: refreshed.providerSubscriptionId,
          }
        }
      } catch {
        result.errors++
        dependencies.recordError?.()
        return
      }
    }

    const notification = dueNotification(current, now)
    if (notification) {
      try {
        await (dependencies.queueSubscriptionNotification ?? queueSubscriptionNotification)(
          notification.kind,
          notification,
        )
      } catch {
        result.errors++
        dependencies.recordError?.()
      }
    }

    try {
      const transition = await dependencies.applyTransition(dependencies.prisma, {
        subscriptionId: current.id,
        ...(expectedCancellationProviderSnapshot
          ? { expectedCancellationProviderSnapshot }
          : {}),
        command: {
          type: 'time_elapsed',
          at: now,
          enforcementEnabled,
          providerCancellationConfirmed,
        },
      })
      if (transition.applied && transition.status === 'suspended') result.suspended++
    } catch {
      result.errors++
      dependencies.recordError?.()
    }

    if (notification) {
      try {
        const delivery = await (dependencies.sendSubscriptionNotification ?? sendSubscriptionNotification)(
          notification.kind,
          notification,
        )
        if (delivery.status === 'sent') result.notified++
      } catch {
        result.errors++
        dependencies.recordError?.()
      }
    }
  } finally {
    try {
      await releaseClaim(dependencies, candidate.id, leaseUntil)
    } catch {
      result.errors++
      dependencies.recordError?.()
    }
  }
}

export async function runSubscriptionBillingCron(
  input: { now: Date },
  dependencies: SubscriptionBillingCronDependencies = runtimeDependencies(),
): Promise<SubscriptionBillingCronResult> {
  const result: SubscriptionBillingCronResult = {
    processed: 0,
    reconciled: 0,
    notified: 0,
    suspended: 0,
    errors: 0,
  }
  try {
    const retries = await (dependencies.retrySubscriptionNotifications ?? retrySubscriptionNotifications)({ now: input.now })
    result.notified += retries.filter((delivery) => delivery.status === 'sent').length
  } catch {
    result.errors++
    dependencies.recordError?.()
  }
  const subscriptions = await dependencies.prisma.businessSubscription.findMany({
    where: {
      billingEnabled: true,
      status: { not: 'cancelled' },
      OR: [
        { billingCronClaimedUntil: null },
        { billingCronClaimedUntil: { lte: input.now } },
      ],
    },
    orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
    take: PAGE_SIZE,
    select: subscriptionSelect,
  })
  const enforcementEnabled = dependencies.enforcementEnabled()
  const claimed: Array<{ candidate: CronSubscription; leaseUntil: Date }> = []
  for (const candidate of subscriptions) {
    try {
      const leaseUntil = await claimSubscription(dependencies, candidate, input.now)
      if (!leaseUntil) continue
      result.processed++
      claimed.push({ candidate, leaseUntil })
    } catch {
      result.errors++
      dependencies.recordError?.()
    }
  }
  for (let offset = 0; offset < claimed.length; offset += CONCURRENCY) {
    await Promise.all(claimed.slice(offset, offset + CONCURRENCY).map(({ candidate, leaseUntil }) =>
      processClaimedSubscription({
        dependencies,
        candidate,
        leaseUntil,
        now: input.now,
        enforcementEnabled,
        result,
      }),
    ))
  }

  return result
}
