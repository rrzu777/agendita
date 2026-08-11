import { createHash } from 'node:crypto'
import type { PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db'
import type { MercadoPagoEnvironment } from '@/lib/payments/mercado-pago-environment'
import { matchesSubscriptionCheckoutAttempt } from './checkout-adoption'
import type { MpSubscriptionClient } from './mercado-pago-client'
import type { MpInvoice, MpSubscription } from './mercado-pago-mappers'
import {
  getSubscriptionWebhookRuntime,
  processSubscriptionWebhook,
  type SubscriptionWebhookEvent,
  type SubscriptionWebhookProcessingResult,
} from './webhook'

export type ReconciliationDependencies = {
  prisma: PrismaClient
  getProcessor(environment: MercadoPagoEnvironment): {
    client: Pick<
      MpSubscriptionClient,
      'getSubscription' | 'searchInvoices' | 'getCurrentAccountId'
    >
    process(event: SubscriptionWebhookEvent): Promise<SubscriptionWebhookProcessingResult>
  }
  now(): Date
}

export class SubscriptionReconciliationValidationError extends Error {
  constructor() {
    super('Mercado Pago subscription reconciliation is inconsistent.')
    this.name = 'SubscriptionReconciliationValidationError'
  }
}

function runtimeDependencies(): ReconciliationDependencies {
  return {
    prisma,
    getProcessor(environment) {
      const runtime = getSubscriptionWebhookRuntime()
      if (runtime.dependencies.environment !== environment) {
        throw new SubscriptionReconciliationValidationError()
      }
      return {
        client: runtime.dependencies.client,
        process: (event) => processSubscriptionWebhook(event, runtime.dependencies),
      }
    },
    now: () => new Date(),
  }
}

function hashReference(reference: string): string {
  return createHash('sha256').update(reference).digest('hex')
}

function assertSubscriptionSnapshot(input: {
  accountId: string
  attempt: {
    businessId: string
    subscriptionId: string
    environment: MercadoPagoEnvironment
    referenceHash: string
    providerSubscriptionId: string | null
    providerPlanId: string | null
    planId: string | null
    amount: number | null
    currency: string | null
  } | null
  candidate: MpSubscription
  local: {
    id: string
    businessId: string
    planId: string
    interval: 'monthly' | 'yearly'
    environment: MercadoPagoEnvironment
    providerSubscriptionId: string
    providerPlanId: string | null
    amount: number
    currency: string
  }
}): void {
  const { accountId, attempt, candidate, local } = input
  const statusIsSupported =
    (candidate.status === 'active' &&
      (candidate.providerStatus === 'authorized' || candidate.providerStatus === 'active') &&
      !!candidate.nextPaymentAt) ||
    (candidate.status === 'canceled' && candidate.providerStatus === 'canceled' && !!candidate.updatedAt)
  if (
    !attempt ||
    !statusIsSupported ||
    candidate.id !== local.providerSubscriptionId ||
    candidate.collectorId !== accountId ||
    candidate.planId !== local.providerPlanId ||
    candidate.amount !== local.amount ||
    candidate.currency !== local.currency ||
    candidate.frequency !== 1 ||
    candidate.frequencyType !== 'months' ||
    local.interval !== 'monthly' ||
    attempt.businessId !== local.businessId ||
    attempt.subscriptionId !== local.id ||
    attempt.environment !== local.environment ||
    attempt.planId !== local.planId ||
    !matchesSubscriptionCheckoutAttempt({ candidate, attempt, hashReference })
  ) {
    throw new SubscriptionReconciliationValidationError()
  }
}

function assertTerminalInvoice(candidate: MpSubscription, invoice: MpInvoice): void {
  const supportedStatus =
    (invoice.status === 'approved' &&
      invoice.providerStatus === 'approved' &&
      !!invoice.providerPaymentId &&
      !!invoice.approvedAt &&
      !!invoice.debitAt) ||
    (invoice.status === 'failed' &&
      (invoice.providerStatus === 'rejected' || invoice.providerStatus === 'cancelled') &&
      !!invoice.debitAt)
  if (
    !supportedStatus ||
    invoice.subscriptionId !== candidate.id ||
    !invoice.externalReference ||
    invoice.externalReference !== candidate.externalReference ||
    invoice.amount !== candidate.amount ||
    invoice.currency !== candidate.currency
  ) {
    throw new SubscriptionReconciliationValidationError()
  }
}

function invoiceOrder(invoice: MpInvoice): [number, number, string] {
  return [
    invoice.debitAt?.getTime() ?? Number.NaN,
    (invoice.approvedAt ?? invoice.updatedAt ?? invoice.createdAt)?.getTime() ?? Number.NaN,
    invoice.id,
  ]
}

function compareInvoices(left: MpInvoice, right: MpInvoice): number {
  const a = invoiceOrder(left)
  const b = invoiceOrder(right)
  return a[0] - b[0] || a[1] - b[1] || a[2].localeCompare(b[2])
}

function assertSafeProcessorOutcome(result: SubscriptionWebhookProcessingResult): void {
  if (result.outcome !== 'applied' && result.outcome !== 'duplicate') {
    throw new SubscriptionReconciliationValidationError()
  }
}

function verifiedPeriodEnd(
  invoice: MpInvoice,
  nextInvoice: MpInvoice | undefined,
  candidate: MpSubscription,
): Date | undefined {
  if (invoice.status !== 'approved' || !invoice.debitAt) return undefined
  const periodEnd = nextInvoice?.debitAt ?? candidate.nextPaymentAt
  if (!periodEnd) {
    if (candidate.status === 'canceled' && !nextInvoice) return undefined
    throw new SubscriptionReconciliationValidationError()
  }
  const days = (periodEnd.getTime() - invoice.debitAt.getTime()) / (24 * 60 * 60 * 1000)
  if (days < 27 || days > 32) throw new SubscriptionReconciliationValidationError()
  return periodEnd
}

export async function reconcileSubscription(
  id: string,
  dependencies: ReconciliationDependencies = runtimeDependencies(),
): Promise<{ outcome: 'reconciled'; invoices: number; applied: number }> {
  const local = await dependencies.prisma.businessSubscription.findUnique({
    where: { id },
    select: {
      id: true,
      businessId: true,
      planId: true,
      interval: true,
      provider: true,
      environment: true,
      providerSubscriptionId: true,
      providerPlanId: true,
      amount: true,
      currency: true,
    },
  })
  if (
    !local ||
    local.provider !== 'mercado_pago' ||
    !local.environment ||
    !local.providerSubscriptionId
  ) {
    throw new SubscriptionReconciliationValidationError()
  }
  const environment = local.environment
  const providerSubscriptionId = local.providerSubscriptionId

  const { client, process } = dependencies.getProcessor(environment)
  const [candidate, invoices, accountId, attempt] = await Promise.all([
    client.getSubscription(providerSubscriptionId),
    client.searchInvoices(providerSubscriptionId),
    client.getCurrentAccountId(),
    dependencies.prisma.subscriptionCheckoutAttempt.findFirst({
      where: {
        businessId: local.businessId,
        subscriptionId: local.id,
        environment,
        providerSubscriptionId,
      },
      select: {
        businessId: true,
        subscriptionId: true,
        environment: true,
        referenceHash: true,
        providerSubscriptionId: true,
        providerPlanId: true,
        planId: true,
        amount: true,
        currency: true,
      },
      orderBy: { createdAt: 'desc' },
    }),
  ])
  assertSubscriptionSnapshot({
    accountId,
    attempt,
    candidate,
    local: { ...local, environment, providerSubscriptionId },
  })

  for (const invoice of invoices) assertTerminalInvoice(candidate, invoice)
  const orderedInvoices = [...invoices].sort(compareInvoices)
  let applied = 0
  for (const [index, invoice] of orderedInvoices.entries()) {
    const result = await process({
      topic: 'subscription_authorized_payment',
      resourceId: invoice.id,
      liveMode: environment === 'production',
      periodEnd: verifiedPeriodEnd(invoice, orderedInvoices[index + 1], candidate),
    })
    assertSafeProcessorOutcome(result)
    if (result.outcome === 'applied') applied++
  }
  if (candidate.status === 'canceled') {
    const result = await process({
      topic: 'subscription_preapproval',
      resourceId: candidate.id,
      liveMode: environment === 'production',
    })
    assertSafeProcessorOutcome(result)
    if (result.outcome === 'applied') applied++
  }

  const marked = await dependencies.prisma.businessSubscription.updateMany({
    where: {
      id: local.id,
      businessId: local.businessId,
      planId: local.planId,
      interval: 'monthly',
      provider: 'mercado_pago',
      environment,
      providerSubscriptionId,
      providerPlanId: local.providerPlanId,
      amount: local.amount,
      currency: local.currency,
    },
    data: { lastReconciledAt: dependencies.now() },
  })
  if (marked.count !== 1) throw new SubscriptionReconciliationValidationError()
  return { outcome: 'reconciled', invoices: orderedInvoices.length, applied }
}
