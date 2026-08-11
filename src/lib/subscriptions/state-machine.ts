import type { BillingClock } from './clock'

export type SubscriptionStatus =
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'suspended'
  | 'cancelled'

export type SubscriptionCommand =
  | { type: 'invoice_approved'; providerPaymentId: string; paidAt: Date; periodEnd: Date }
  | { type: 'invoice_failed'; occurredAt: Date }
  | { type: 'time_elapsed'; at: Date; enforcementEnabled: boolean }
  | { type: 'cancel_at_period_end'; requestedAt: Date }
  | { type: 'provider_cancelled'; occurredAt: Date }

export type SubscriptionState = {
  status: SubscriptionStatus
  currentPeriodStart: Date
  currentPeriodEnd: Date
  trialStartAt: Date | null
  trialEndAt: Date | null
  cancelledAt: Date | null
  suspendedAt: Date | null
  suspendedReason: string | null
  nextBillingAt: Date | null
  lastPaidAt: Date | null
  pastDueAt: Date | null
  graceEndsAt: Date | null
  graceDays: number
  cancelAtPeriodEnd: boolean
  cancellationRequestedAt: Date | null
  complimentaryUntil: Date | null
  providerSubscriptionId?: string | null
}

export type SubscriptionStateChanges = Partial<Omit<SubscriptionState, 'status'>>

export type SubscriptionTransitionInput = {
  subscription: SubscriptionState
  command: SubscriptionCommand
  clock: BillingClock
  paymentAlreadyApplied?: boolean
}

export type DerivedSubscriptionTransition = {
  nextStatus: SubscriptionStatus
  changes: SubscriptionStateChanges
  auditAction: string | null
  ignored: boolean
}

const DAY_IN_MS = 24 * 60 * 60 * 1000

function noChange(subscription: SubscriptionState): DerivedSubscriptionTransition {
  return {
    nextStatus: subscription.status,
    changes: {},
    auditAction: null,
    ignored: true,
  }
}

function pastDueChanges(subscription: SubscriptionState, occurredAt: Date): SubscriptionStateChanges {
  if (subscription.pastDueAt && subscription.graceEndsAt) return {}

  const pastDueAt = subscription.pastDueAt ?? occurredAt
  return {
    ...(!subscription.pastDueAt ? { pastDueAt } : {}),
    ...(!subscription.graceEndsAt
      ? { graceEndsAt: new Date(pastDueAt.getTime() + subscription.graceDays * DAY_IN_MS) }
      : {}),
  }
}

export function deriveSubscriptionTransition(
  input: SubscriptionTransitionInput,
): DerivedSubscriptionTransition {
  const { subscription, command } = input

  if (command.type === 'invoice_approved') {
    if (
      input.paymentAlreadyApplied ||
      (subscription.lastPaidAt && command.paidAt.getTime() < subscription.lastPaidAt.getTime()) ||
      command.periodEnd.getTime() <= subscription.currentPeriodEnd.getTime()
    ) {
      return noChange(subscription)
    }

    return {
      nextStatus: 'active',
      changes: {
        currentPeriodStart: command.paidAt,
        currentPeriodEnd: command.periodEnd,
        nextBillingAt: command.periodEnd,
        lastPaidAt: command.paidAt,
        pastDueAt: null,
        graceEndsAt: null,
        suspendedAt: null,
        suspendedReason: null,
      },
      auditAction: subscription.status === 'past_due'
        ? 'subscription_recovered'
        : 'invoice_approved',
      ignored: false,
    }
  }

  if (command.type === 'invoice_failed') {
    if (
      subscription.status === 'cancelled' ||
      (subscription.lastPaidAt && command.occurredAt.getTime() <= subscription.lastPaidAt.getTime())
    ) {
      return noChange(subscription)
    }

    const changes = pastDueChanges(subscription, command.occurredAt)
    if (subscription.status === 'past_due' && Object.keys(changes).length === 0) {
      return {
        nextStatus: 'past_due',
        changes,
        auditAction: null,
        ignored: true,
      }
    }

    return {
      nextStatus: 'past_due',
      changes,
      auditAction: 'invoice_failed',
      ignored: false,
    }
  }

  if (command.type === 'cancel_at_period_end') {
    if (subscription.status === 'cancelled' || subscription.cancelAtPeriodEnd) {
      return noChange(subscription)
    }
    return {
      nextStatus: subscription.status,
      changes: {
        cancelAtPeriodEnd: true,
        cancellationRequestedAt: command.requestedAt,
      },
      auditAction: 'subscription_cancellation_requested',
      ignored: false,
    }
  }

  if (command.type === 'provider_cancelled') {
    if (subscription.status === 'cancelled') return noChange(subscription)
    return {
      nextStatus: 'cancelled',
      changes: { cancelledAt: command.occurredAt, nextBillingAt: null },
      auditAction: 'subscription_cancelled_by_provider',
      ignored: false,
    }
  }

  const at = command.at
  if (subscription.status === 'cancelled') return noChange(subscription)

  if (
    subscription.cancelAtPeriodEnd &&
    at.getTime() >= subscription.currentPeriodEnd.getTime()
  ) {
    return {
      nextStatus: 'cancelled',
      changes: { cancelledAt: at, nextBillingAt: null },
      auditAction: 'subscription_cancelled_at_period_end',
      ignored: false,
    }
  }

  if (
    subscription.complimentaryUntil &&
    at.getTime() < subscription.complimentaryUntil.getTime()
  ) {
    return subscription.status === 'trialing'
      ? noChange(subscription)
      : {
          nextStatus: 'trialing',
          changes: {},
          auditAction: 'complimentary_access_applied',
          ignored: false,
        }
  }

  if (subscription.status === 'trialing') {
    const accessEndsAt = subscription.complimentaryUntil ?? subscription.trialEndAt
    if (!accessEndsAt || at.getTime() < accessEndsAt.getTime()) return noChange(subscription)
    if (!subscription.complimentaryUntil && subscription.providerSubscriptionId) {
      return noChange(subscription)
    }

    return {
      nextStatus: 'past_due',
      changes: pastDueChanges(subscription, accessEndsAt),
      auditAction: subscription.complimentaryUntil
        ? 'complimentary_access_expired'
        : 'trial_expired',
      ignored: false,
    }
  }

  if (
    subscription.status === 'past_due' &&
    subscription.graceEndsAt &&
    at.getTime() >= subscription.graceEndsAt.getTime()
  ) {
    if (!command.enforcementEnabled) {
      return {
        nextStatus: 'past_due',
        changes: {},
        auditAction: 'grace_expired_unenforced',
        ignored: false,
      }
    }
    return {
      nextStatus: 'suspended',
      changes: { suspendedAt: at, suspendedReason: 'grace_period_expired' },
      auditAction: 'subscription_suspended',
      ignored: false,
    }
  }

  return noChange(subscription)
}
