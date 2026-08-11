export type SubscriptionStatus =
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'suspended'
  | 'cancelled'

export type SubscriptionCommand =
  | {
      type: 'invoice_approved'
      providerPaymentId: string
      paidAt: Date
      periodStart?: Date
      periodEnd: Date
    }
  | { type: 'invoice_failed'; occurredAt: Date }
  | {
      type: 'time_elapsed'
      at: Date
      enforcementEnabled: boolean
      providerCancellationConfirmed?: boolean
    }
  | { type: 'cancel_at_period_end'; requestedAt: Date }
  | { type: 'provider_cancelled'; occurredAt: Date }

export type SubscriptionState = {
  status: SubscriptionStatus
  provider: 'manual' | 'mercado_pago'
  interval: 'monthly' | 'yearly'
  currentPeriodStart: Date
  currentPeriodEnd: Date
  trialStartAt: Date | null
  trialEndAt: Date | null
  trialDays: number
  cancelledAt: Date | null
  suspendedAt: Date | null
  suspendedReason: string | null
  nextBillingAt: Date | null
  lastPaidAt: Date | null
  pastDueAt: Date | null
  graceEndsAt: Date | null
  graceDays: number
  graceEnforcementDeferredAt: Date | null
  cancelAtPeriodEnd: boolean
  cancellationRequestedAt: Date | null
  complimentaryUntil: Date | null
  providerSubscriptionId: string | null
}

export type SubscriptionStateChanges = Partial<Omit<SubscriptionState, 'status'>>

export type SubscriptionTransitionInput = {
  subscription: SubscriptionState
  command: SubscriptionCommand
  paymentAlreadyApplied?: boolean
}

export type DerivedSubscriptionTransition = {
  nextStatus: SubscriptionStatus
  changes: SubscriptionStateChanges
  auditAction: string | null
  ignored: boolean
}

const DAY_IN_MS = 24 * 60 * 60 * 1000
const MIN_MONTH_DAYS = 27
const MAX_MONTH_DAYS = 32

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_IN_MS)
}

function monthlyCycleStart(
  subscription: SubscriptionState,
  paidAt: Date,
  periodEnd: Date,
  periodStart?: Date,
): Date {
  const candidates = periodStart ? [periodStart] : [paidAt, subscription.currentPeriodEnd]
  for (const candidate of candidates) {
    if (!candidate) continue
    const days = (periodEnd.getTime() - candidate.getTime()) / DAY_IN_MS
    if (days >= MIN_MONTH_DAYS && days <= MAX_MONTH_DAYS) return candidate
  }
  throw new Error('El período mensual debe durar entre 27 y 32 días')
}

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
    ...(subscription.graceEnforcementDeferredAt
      ? { graceEnforcementDeferredAt: null }
      : {}),
  }
}

export function deriveSubscriptionTransition(
  input: SubscriptionTransitionInput,
): DerivedSubscriptionTransition {
  const { subscription, command } = input

  if (subscription.interval !== 'monthly') {
    throw new Error('Sólo se admiten suscripciones monthly')
  }

  if (command.type === 'invoice_approved') {
    if (
      input.paymentAlreadyApplied ||
      command.periodEnd.getTime() <= subscription.currentPeriodEnd.getTime()
    ) {
      return noChange(subscription)
    }

    const currentPeriodStart = monthlyCycleStart(
      subscription,
      command.paidAt,
      command.periodEnd,
      command.periodStart,
    )

    return {
      nextStatus: 'active',
      changes: {
        currentPeriodStart,
        currentPeriodEnd: command.periodEnd,
        nextBillingAt: command.periodEnd,
        lastPaidAt: subscription.lastPaidAt && subscription.lastPaidAt > command.paidAt
          ? subscription.lastPaidAt
          : command.paidAt,
        pastDueAt: null,
        graceEndsAt: null,
        graceEnforcementDeferredAt: null,
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
      subscription.status === 'suspended' ||
      command.occurredAt.getTime() < subscription.currentPeriodEnd.getTime()
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
    if (subscription.status === 'cancelled' || subscription.cancelAtPeriodEnd) {
      return noChange(subscription)
    }
    return {
      nextStatus: subscription.status,
      changes: {
        cancelAtPeriodEnd: true,
        cancellationRequestedAt: command.occurredAt,
      },
      auditAction: 'subscription_cancellation_requested_by_provider',
      ignored: false,
    }
  }

  const at = command.at
  if (subscription.status === 'cancelled') return noChange(subscription)

  if (
    subscription.cancelAtPeriodEnd &&
    at.getTime() >= subscription.currentPeriodEnd.getTime() &&
    (
      command.providerCancellationConfirmed === true ||
      (
        subscription.provider === 'manual' &&
        subscription.providerSubscriptionId === null
      )
    )
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
    if (subscription.complimentaryUntil) {
      const trialWasDeferred = Boolean(
        subscription.trialStartAt &&
        subscription.trialStartAt.getTime() >= subscription.complimentaryUntil.getTime(),
      )
      if (!trialWasDeferred && subscription.trialDays > 0) {
        const trialEndAt = addDays(subscription.complimentaryUntil, subscription.trialDays)
        return {
          nextStatus: 'trialing',
          changes: {
            trialStartAt: subscription.complimentaryUntil,
            trialEndAt,
            currentPeriodStart: subscription.complimentaryUntil,
            currentPeriodEnd: trialEndAt,
          },
          auditAction: 'trial_started_after_complimentary',
          ignored: false,
        }
      }
      if (!trialWasDeferred) {
        return {
          nextStatus: 'past_due',
          changes: pastDueChanges(subscription, subscription.complimentaryUntil),
          auditAction: 'trial_expired',
          ignored: false,
        }
      }
    }

    const accessEndsAt = subscription.trialEndAt ?? subscription.complimentaryUntil
    if (!accessEndsAt || at.getTime() < accessEndsAt.getTime()) return noChange(subscription)
    if (subscription.providerSubscriptionId) {
      return noChange(subscription)
    }

    return {
      nextStatus: 'past_due',
      changes: pastDueChanges(subscription, accessEndsAt),
      auditAction: 'trial_expired',
      ignored: false,
    }
  }

  if (
    subscription.status === 'past_due' &&
    subscription.graceEndsAt &&
    at.getTime() >= subscription.graceEndsAt.getTime()
  ) {
    if (!command.enforcementEnabled) {
      if (subscription.graceEnforcementDeferredAt) return noChange(subscription)
      return {
        nextStatus: 'past_due',
        changes: { graceEnforcementDeferredAt: at },
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
