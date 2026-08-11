import 'server-only'

import type { MercadoPagoEnvironment, Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import type { MpSubscription } from './mercado-pago-mappers'

type CheckoutSubscription = Prisma.BusinessSubscriptionGetPayload<{
  include: { plan: true }
}>

export function matchesSubscriptionCheckoutAttempt(input: {
  candidate: MpSubscription
  attempt: {
    referenceHash: string
    providerSubscriptionId: string | null
    providerPlanId: string | null
    amount: number | null
    currency: string | null
  }
  hashReference: (reference: string) => string
}): boolean {
  const { candidate, attempt, hashReference } = input
  return candidate.id === attempt.providerSubscriptionId &&
    !!candidate.externalReference && hashReference(candidate.externalReference) === attempt.referenceHash &&
    !!attempt.providerPlanId && candidate.planId === attempt.providerPlanId &&
    candidate.amount === attempt.amount && candidate.currency === attempt.currency
}

export class CheckoutEligibilityConflictError extends Error {
  constructor(message = 'La suscripción dejó de ser elegible durante el checkout.') {
    super(message)
    this.name = 'CheckoutEligibilityConflictError'
  }
}

export async function adoptAuthorizedSubscriptionCandidate(input: {
  candidate: MpSubscription
  attemptId: string
  subscription: CheckoutSubscription
  businessId: string
  environment: MercadoPagoEnvironment
  providerPlanId: string
  now: Date
  attempt: {
    providerSubscriptionId: string | null
    providerPlanId: string | null
    planId: string | null
    amount: number | null
    currency: string | null
  }
}): Promise<void> {
  const {
    candidate, attemptId, subscription, businessId, environment, providerPlanId, now, attempt,
  } = input
  if (candidate.providerStatus !== 'authorized') {
    throw new Error('Sólo una autorización confirmada por Mercado Pago se puede vincular.')
  }
  await prisma.$transaction(async (tx) => {
    const current = await tx.businessSubscription.findUnique({ where: { id: subscription.id } })
    const stillEligible = current &&
      current.businessId === businessId &&
      current.updatedAt.getTime() === subscription.updatedAt.getTime() &&
      current.billingEnabled &&
      (!current.complimentaryUntil || current.complimentaryUntil.getTime() <= now.getTime()) &&
      current.interval === 'monthly' &&
      (current.status === 'trialing' || current.status === 'past_due') &&
      current.providerSubscriptionId === null &&
      current.planId === subscription.planId && current.planId === attempt.planId &&
      current.amount === subscription.amount && current.amount === attempt.amount &&
      current.currency === subscription.currency && current.currency === attempt.currency &&
      current.provider === subscription.provider && current.environment === subscription.environment
    if (!stillEligible) {
      if (current?.providerSubscriptionId === candidate.id) return
      throw new CheckoutEligibilityConflictError()
    }
    const claimed = await tx.subscriptionCheckoutAttempt.updateMany({
      where: {
        id: attemptId,
        businessId,
        subscriptionId: subscription.id,
        environment,
        providerSubscriptionId: candidate.id,
        providerPlanId,
        planId: attempt.planId,
        amount: attempt.amount,
        currency: attempt.currency,
        invalidatedAt: null,
      },
      data: { invalidatedAt: now },
    })
    if (claimed.count !== 1) {
      const afterClaim = await tx.businessSubscription.findUnique({ where: { id: subscription.id } })
      if (afterClaim?.providerSubscriptionId === candidate.id) return
      throw new CheckoutEligibilityConflictError('El checkout autorizado ya no está vigente.')
    }
    const linked = await tx.businessSubscription.updateMany({
      where: {
        id: subscription.id,
        businessId,
        updatedAt: current.updatedAt,
        billingEnabled: true,
        interval: 'monthly',
        status: { in: ['trialing', 'past_due'] },
        providerSubscriptionId: null,
        planId: attempt.planId!,
        amount: attempt.amount!,
        currency: attempt.currency!,
        provider: subscription.provider,
        environment: subscription.environment,
        OR: [
          { complimentaryUntil: null },
          { complimentaryUntil: { lte: now } },
        ],
      },
      data: {
        provider: 'mercado_pago', environment, providerPlanId,
        providerSubscriptionId: candidate.id, nextBillingAt: candidate.nextPaymentAt,
      },
    })
    if (linked.count === 1) {
      await tx.subscriptionLog.create({
        data: {
          businessId,
          action: 'provider_subscription_authorized',
          beforeStatus: subscription.status,
          afterStatus: subscription.status,
          beforePlanId: subscription.planId,
          afterPlanId: subscription.planId,
        },
      })
    } else {
      const afterLink = await tx.businessSubscription.findUnique({ where: { id: subscription.id } })
      if (afterLink?.providerSubscriptionId !== candidate.id) {
        throw new CheckoutEligibilityConflictError(
          'La suscripción cambió durante la autorización del checkout.',
        )
      }
    }
  })
}
