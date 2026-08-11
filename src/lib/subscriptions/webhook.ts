import { createHash } from 'node:crypto'
import type { PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db'
import type { MercadoPagoEnvironment } from '@/lib/payments/mercado-pago-environment'
import { requireMercadoPagoEnvironment } from '@/lib/payments/mercado-pago-environment'
import {
  adoptAuthorizedSubscriptionCandidate,
  CheckoutEligibilityConflictError,
  matchesSubscriptionCheckoutAttempt,
} from './checkout-adoption'
import {
  createMpSubscriptionClient,
  type MpSubscriptionClient,
} from './mercado-pago-client'
import type { MpSubscription } from './mercado-pago-mappers'
import {
  applySubscriptionTransition,
  SubscriptionProviderSnapshotMismatchError,
  SubscriptionTransitionConflictError,
  type ApplySubscriptionTransitionCommand,
} from './transition'

export type SubscriptionWebhookEvent = {
  topic: 'subscription_preapproval' | 'subscription_authorized_payment'
  resourceId: string
  liveMode: boolean
}

export type SubscriptionWebhookDependencies = {
  prisma: PrismaClient
  client: MpSubscriptionClient
  environment: MercadoPagoEnvironment
  applyTransition: (
    prisma: PrismaClient,
    input: ApplySubscriptionTransitionCommand,
  ) => Promise<{ applied: boolean; status: string }>
  adoptCandidate: typeof adoptAuthorizedSubscriptionCandidate
  now: () => Date
}

export class SubscriptionWebhookValidationError extends Error {
  constructor() {
    super('Mercado Pago subscription webhook is inconsistent.')
    this.name = 'SubscriptionWebhookValidationError'
  }
}

export class SubscriptionWebhookConfigurationError extends Error {
  constructor() {
    super('Mercado Pago subscriptions webhook configuration is incomplete.')
    this.name = 'SubscriptionWebhookConfigurationError'
  }
}

export function getSubscriptionWebhookRuntime(): {
  webhookSecret: string
  dependencies: SubscriptionWebhookDependencies
} {
  const environment = requireMercadoPagoEnvironment()
  const prefix = `MERCADO_PAGO_${environment.toUpperCase()}`
  const accessToken = process.env[`${prefix}_ACCESS_TOKEN`]
  const webhookSecret = process.env[`${prefix}_WEBHOOK_SECRET`]
  const callbackUrl = process.env[`${prefix}_SUBSCRIPTIONS_CALLBACK_URL`]
  if (!accessToken || !webhookSecret || !callbackUrl) {
    throw new SubscriptionWebhookConfigurationError()
  }
  return {
    webhookSecret,
    dependencies: {
      prisma,
      environment,
      client: createMpSubscriptionClient({ accessToken, webhookSecret, callbackUrl, environment }),
      applyTransition: applySubscriptionTransition,
      adoptCandidate: adoptAuthorizedSubscriptionCandidate,
      now: () => new Date(),
    },
  }
}

function hashReference(reference: string): string {
  return createHash('sha256').update(reference).digest('hex')
}

type LocalSubscription = NonNullable<Awaited<ReturnType<typeof findLocalSubscription>>>
type CheckoutAttempt = NonNullable<Awaited<ReturnType<typeof findCheckoutAttempt>>>

function findLocalSubscription(
  dependencies: SubscriptionWebhookDependencies,
  providerSubscriptionId: string,
) {
  return dependencies.prisma.businessSubscription.findFirst({
    where: {
      provider: 'mercado_pago',
      environment: dependencies.environment,
      providerSubscriptionId,
    },
    include: { plan: true },
  })
}

function findCheckoutAttempt(
  dependencies: SubscriptionWebhookDependencies,
  providerSubscriptionId: string,
) {
  return dependencies.prisma.subscriptionCheckoutAttempt.findFirst({
    where: {
      environment: dependencies.environment,
      providerSubscriptionId,
    },
    include: { subscription: { include: { plan: true } } },
    orderBy: { createdAt: 'desc' },
  })
}

function assertProviderSubscription(input: {
  candidate: MpSubscription
  accountId: string
  local: LocalSubscription | null
  attempt: CheckoutAttempt | null
}): void {
  const { candidate, accountId, local, attempt } = input
  if (!candidate.collectorId || candidate.collectorId !== accountId) {
    throw new SubscriptionWebhookValidationError()
  }
  if (!attempt || !matchesSubscriptionCheckoutAttempt({
    candidate,
    attempt,
    hashReference,
  })) {
    throw new SubscriptionWebhookValidationError()
  }
  if (
    local && (
      local.id !== attempt.subscriptionId ||
      local.businessId !== attempt.businessId ||
      local.provider !== 'mercado_pago' ||
      local.environment !== attempt.environment ||
      local.providerSubscriptionId !== candidate.id ||
      local.providerPlanId !== candidate.planId ||
      local.planId !== attempt.planId ||
      local.amount !== candidate.amount ||
      local.currency !== candidate.currency
    )
  ) {
    throw new SubscriptionWebhookValidationError()
  }
}

async function resolveSubscription(input: {
  candidate: MpSubscription
  dependencies: SubscriptionWebhookDependencies
  accountId: string
  requireAdopted: boolean
}): Promise<LocalSubscription | null> {
  const { candidate, dependencies, accountId, requireAdopted } = input
  let [local, attempt] = await Promise.all([
    findLocalSubscription(dependencies, candidate.id),
    findCheckoutAttempt(dependencies, candidate.id),
  ])
  assertProviderSubscription({ candidate, accountId, local, attempt })

  if (!local && candidate.providerStatus === 'authorized') {
    try {
      await dependencies.adoptCandidate({
        candidate,
        attemptId: attempt!.id,
        attempt: {
          providerSubscriptionId: attempt!.providerSubscriptionId,
          providerPlanId: attempt!.providerPlanId,
          planId: attempt!.planId,
          amount: attempt!.amount,
          currency: attempt!.currency,
        },
        subscription: attempt!.subscription,
        businessId: attempt!.businessId,
        environment: dependencies.environment,
        providerPlanId: attempt!.providerPlanId!,
        now: dependencies.now(),
      })
    } catch (error) {
      if (error instanceof CheckoutEligibilityConflictError) {
        const cancelled = await dependencies.client.cancelSubscription(candidate.id)
        if (cancelled.id !== candidate.id || cancelled.status !== 'canceled') {
          throw new SubscriptionWebhookValidationError()
        }
        await dependencies.prisma.subscriptionCheckoutAttempt.updateMany({
          where: { id: attempt!.id, invalidatedAt: null },
          data: { invalidatedAt: dependencies.now() },
        })
        throw new SubscriptionWebhookValidationError()
      }
      throw error
    }
    local = await findLocalSubscription(dependencies, candidate.id)
    attempt = await findCheckoutAttempt(dependencies, candidate.id)
    assertProviderSubscription({ candidate, accountId, local, attempt })
  }

  if (requireAdopted && !local) throw new SubscriptionWebhookValidationError()
  return local
}

async function applyTransitionWithConflictRetry(
  dependencies: SubscriptionWebhookDependencies,
  input: ApplySubscriptionTransitionCommand,
) {
  try {
    return await dependencies.applyTransition(dependencies.prisma, input)
  } catch (error) {
    if (error instanceof SubscriptionProviderSnapshotMismatchError) {
      throw new SubscriptionWebhookValidationError()
    }
    if (!(error instanceof SubscriptionTransitionConflictError)) throw error
    try {
      return await dependencies.applyTransition(dependencies.prisma, input)
    } catch (retryError) {
      if (retryError instanceof SubscriptionProviderSnapshotMismatchError) {
        throw new SubscriptionWebhookValidationError()
      }
      throw retryError
    }
  }
}

function expectedProviderSnapshot(local: LocalSubscription) {
  if (
    local.provider !== 'mercado_pago' ||
    !local.environment ||
    !local.providerSubscriptionId ||
    !local.providerPlanId
  ) {
    throw new SubscriptionWebhookValidationError()
  }
  return {
    provider: local.provider,
    environment: local.environment,
    providerSubscriptionId: local.providerSubscriptionId,
    planId: local.planId,
    providerPlanId: local.providerPlanId,
    amount: local.amount,
    currency: local.currency,
    updatedAt: local.updatedAt,
  }
}

async function applyInvoice(
  event: SubscriptionWebhookEvent,
  dependencies: SubscriptionWebhookDependencies,
) {
  const invoice = await dependencies.client.getInvoice(event.resourceId)
  if (!invoice.subscriptionId) throw new SubscriptionWebhookValidationError()

  const [candidate, accountId] = await Promise.all([
    dependencies.client.getSubscription(invoice.subscriptionId),
    dependencies.client.getCurrentAccountId(),
  ])
  if (candidate.id !== invoice.subscriptionId) throw new SubscriptionWebhookValidationError()
  const local = await resolveSubscription({
    candidate,
    dependencies,
    accountId,
    requireAdopted: invoice.status === 'approved' || invoice.status === 'failed',
  })
  if (
    invoice.externalReference !== candidate.externalReference ||
    !invoice.externalReference ||
    hashReference(invoice.externalReference) !== (await findCheckoutAttempt(
      dependencies,
      candidate.id,
    ))?.referenceHash ||
    invoice.amount !== candidate.amount ||
    invoice.currency !== candidate.currency
  ) {
    throw new SubscriptionWebhookValidationError()
  }

  if (invoice.status === 'pending' || invoice.status === 'ignored') {
    return { outcome: 'ignored' as const }
  }
  if (!local) throw new SubscriptionWebhookValidationError()

  if (invoice.status === 'approved') {
    if (!invoice.providerPaymentId || !invoice.approvedAt || !candidate.nextPaymentAt) {
      throw new SubscriptionWebhookValidationError()
    }
    const result = await applyTransitionWithConflictRetry(dependencies, {
      subscriptionId: local.id,
      command: {
        type: 'invoice_approved',
        providerPaymentId: invoice.providerPaymentId,
        paidAt: invoice.approvedAt,
        periodEnd: candidate.nextPaymentAt,
      },
      payment: {
        providerInvoiceId: invoice.id,
        providerStatus: invoice.providerStatus ?? undefined,
        providerUpdatedAt: invoice.updatedAt ?? undefined,
      },
      expectedProviderSnapshot: expectedProviderSnapshot(local),
    })
    return {
      outcome: result.applied ? 'applied' as const : 'duplicate' as const,
      status: result.status,
    }
  }

  const existingApproved = await dependencies.prisma.subscriptionPayment.findUnique({
    where: {
      provider_environment_providerInvoiceId: {
        provider: 'mercado_pago',
        environment: dependencies.environment,
        providerInvoiceId: invoice.id,
      },
    },
    select: { id: true },
  })
  if (existingApproved) return { outcome: 'duplicate' as const, status: local.status }
  const occurredAt = invoice.debitAt ?? invoice.createdAt
  if (!occurredAt) throw new SubscriptionWebhookValidationError()
  const result = await applyTransitionWithConflictRetry(dependencies, {
    subscriptionId: local.id,
    command: { type: 'invoice_failed', occurredAt },
    payment: {
      providerInvoiceId: invoice.id,
      providerStatus: invoice.providerStatus ?? undefined,
      providerUpdatedAt: invoice.updatedAt ?? undefined,
    },
    expectedProviderSnapshot: expectedProviderSnapshot(local),
  })
  return {
    outcome: result.applied ? 'applied' as const : 'duplicate' as const,
    status: result.status,
  }
}

async function applySubscription(
  event: SubscriptionWebhookEvent,
  dependencies: SubscriptionWebhookDependencies,
) {
  const [candidate, accountId] = await Promise.all([
    dependencies.client.getSubscription(event.resourceId),
    dependencies.client.getCurrentAccountId(),
  ])
  if (candidate.id !== event.resourceId) throw new SubscriptionWebhookValidationError()
  const local = await resolveSubscription({
    candidate,
    dependencies,
    accountId,
    requireAdopted: candidate.status === 'canceled',
  })
  if (candidate.status !== 'canceled') return { outcome: 'ignored' as const }
  if (!local) throw new SubscriptionWebhookValidationError()
  const result = await applyTransitionWithConflictRetry(dependencies, {
    subscriptionId: local.id,
    command: {
      type: 'provider_cancelled',
      occurredAt: candidate.updatedAt ?? dependencies.now(),
    },
    expectedProviderSnapshot: expectedProviderSnapshot(local),
  })
  return {
    outcome: result.applied ? 'applied' as const : 'duplicate' as const,
    status: result.status,
  }
}

export async function processSubscriptionWebhook(
  event: SubscriptionWebhookEvent,
  dependencies: SubscriptionWebhookDependencies = getSubscriptionWebhookRuntime().dependencies,
) {
  if (event.liveMode !== (dependencies.environment === 'production')) {
    throw new SubscriptionWebhookValidationError()
  }
  return event.topic === 'subscription_authorized_payment'
    ? applyInvoice(event, dependencies)
    : applySubscription(event, dependencies)
}
