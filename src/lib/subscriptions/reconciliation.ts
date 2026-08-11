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
      'getSubscription' | 'searchInvoices' | 'getCurrentAccountId' | 'cancelSubscription'
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

export class SubscriptionReconciliationPartialError extends Error {
  constructor() {
    super('Mercado Pago subscription reconciliation has durable work remaining.')
    this.name = 'SubscriptionReconciliationPartialError'
  }
}

// The capped history search costs at most 5 pages x 5 s. Each authoritative
// invoice processor has two sequential 5 s network phases, so three invoices
// keep the run near 55 s and well inside the five-minute lease. When that full
// budget is used, provider cancellation is deferred to the next cron run.
export const MAX_MISSING_INVOICES_PER_RECONCILIATION = 3

export type SubscriptionReconciliationResult = {
  outcome: 'reconciled'
  invoices: number
  applied: number
  providerTerminalCanceled: boolean
}

type ReconciliationLocalSnapshot = {
  id: string
  businessId: string
  planId: string
  interval: 'monthly' | 'yearly'
  status: 'trialing' | 'active' | 'past_due' | 'suspended' | 'cancelled'
  provider: 'manual' | 'mercado_pago'
  environment: MercadoPagoEnvironment | null
  providerSubscriptionId: string | null
  providerPlanId: string | null
  amount: number
  currency: string
  currentPeriodStart: Date
  currentPeriodEnd: Date
  cancelAtPeriodEnd: boolean
  cancellationRequestedAt: Date | null
  updatedAt: Date
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

function sameDate(left: Date | null, right: Date | null): boolean {
  return left?.getTime() === right?.getTime()
}

function assertFinancialIdentityUnchanged(
  initial: ReconciliationLocalSnapshot,
  current: ReconciliationLocalSnapshot | null,
): asserts current is ReconciliationLocalSnapshot {
  if (
    !current ||
    current.id !== initial.id ||
    current.businessId !== initial.businessId ||
    current.planId !== initial.planId ||
    current.interval !== initial.interval ||
    current.provider !== initial.provider ||
    current.environment !== initial.environment ||
    current.providerSubscriptionId !== initial.providerSubscriptionId ||
    current.providerPlanId !== initial.providerPlanId ||
    current.amount !== initial.amount ||
    current.currency !== initial.currency
  ) {
    throw new SubscriptionReconciliationValidationError()
  }
}

function assertCancellationIntentUnchanged(
  initial: ReconciliationLocalSnapshot,
  current: ReconciliationLocalSnapshot,
): void {
  if (
    current.cancelAtPeriodEnd !== initial.cancelAtPeriodEnd ||
    !sameDate(current.cancellationRequestedAt, initial.cancellationRequestedAt)
  ) {
    throw new SubscriptionReconciliationValidationError()
  }
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
    cancelAtPeriodEnd: boolean
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

type LocalInvoiceClaim = {
  id: string
  businessId: string
  subscriptionId: string
  provider: string
  environment: MercadoPagoEnvironment | null
  status: string
  providerPaymentId: string | null
  providerInvoiceId: string | null
}

function expectedClaimStatus(invoice: MpInvoice): string {
  if (invoice.status === 'approved') return 'approved'
  return invoice.providerStatus === 'cancelled' ? 'cancelled' : 'rejected'
}

function findInvoiceClaim(
  local: { id: string; businessId: string; environment: MercadoPagoEnvironment },
  claims: LocalInvoiceClaim[],
  invoice: MpInvoice,
): LocalInvoiceClaim | null {
  const matches = claims.filter((claim) =>
    claim.providerInvoiceId === invoice.id ||
    (!!invoice.providerPaymentId && claim.providerPaymentId === invoice.providerPaymentId),
  )
  if (matches.length === 0) return null
  const claim = matches[0]
  if (
    matches.some((candidate) => candidate.id !== claim.id) ||
    claim.provider !== 'mercado_pago' ||
    claim.environment !== local.environment ||
    claim.subscriptionId !== local.id ||
    claim.businessId !== local.businessId ||
    (claim.providerInvoiceId !== null && claim.providerInvoiceId !== invoice.id) ||
    (claim.providerPaymentId !== null && invoice.providerPaymentId !== null &&
      claim.providerPaymentId !== invoice.providerPaymentId)
  ) {
    throw new SubscriptionReconciliationValidationError()
  }
  return claim
}

function claimMatchesInvoice(claim: LocalInvoiceClaim | null, invoice: MpInvoice): boolean {
  if (!claim || claim.providerInvoiceId !== invoice.id) {
    return false
  }
  const paymentIdIsCompatible = invoice.providerPaymentId === null ||
    claim.providerPaymentId === invoice.providerPaymentId
  if (!paymentIdIsCompatible) return false
  return claim.status === expectedClaimStatus(invoice) ||
    (claim.status === 'approved' && invoice.status === 'failed')
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
): Promise<SubscriptionReconciliationResult> {
  const local = await dependencies.prisma.businessSubscription.findUnique({
    where: { id },
    select: {
      id: true,
      businessId: true,
      planId: true,
      interval: true,
      status: true,
      provider: true,
      environment: true,
      providerSubscriptionId: true,
      providerPlanId: true,
      amount: true,
      currency: true,
      currentPeriodStart: true,
      currentPeriodEnd: true,
      cancelAtPeriodEnd: true,
      cancellationRequestedAt: true,
      updatedAt: true,
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
  const providerPaymentIds = orderedInvoices.flatMap((invoice) =>
    invoice.providerPaymentId ? [invoice.providerPaymentId] : [],
  )
  const claims = await dependencies.prisma.subscriptionPayment.findMany({
    where: {
      provider: 'mercado_pago',
      environment,
      OR: [
        { providerInvoiceId: { in: orderedInvoices.map((invoice) => invoice.id) } },
        ...(providerPaymentIds.length > 0
          ? [{ providerPaymentId: { in: providerPaymentIds } }]
          : []),
      ],
    },
    select: {
      id: true,
      businessId: true,
      subscriptionId: true,
      provider: true,
      environment: true,
      status: true,
      providerPaymentId: true,
      providerInvoiceId: true,
    },
  })
  const actionableInvoices = orderedInvoices.filter((invoice) =>
    !claimMatchesInvoice(findInvoiceClaim({
      id: local.id,
      businessId: local.businessId,
      environment,
    }, claims, invoice), invoice),
  )
  const replayBatch = actionableInvoices.slice(0, MAX_MISSING_INVOICES_PER_RECONCILIATION)
  let applied = 0
  for (const invoice of replayBatch) {
    const index = orderedInvoices.indexOf(invoice)
    const result = await process({
      topic: 'subscription_authorized_payment',
      resourceId: invoice.id,
      liveMode: environment === 'production',
      periodEnd: verifiedPeriodEnd(invoice, orderedInvoices[index + 1], candidate),
    })
    assertSafeProcessorOutcome(result)
    if (result.outcome === 'applied') applied++
  }
  if (actionableInvoices.length > replayBatch.length) {
    throw new SubscriptionReconciliationPartialError()
  }
  const hasPendingCancellation = candidate.status === 'canceled' ||
    (candidate.status === 'active' && local.cancelAtPeriodEnd)
  if (
    hasPendingCancellation &&
    replayBatch.length === MAX_MISSING_INVOICES_PER_RECONCILIATION
  ) {
    throw new SubscriptionReconciliationPartialError()
  }
  let sealSnapshot = await dependencies.prisma.businessSubscription.findUnique({
    where: { id: local.id },
    select: {
      id: true,
      businessId: true,
      planId: true,
      interval: true,
      status: true,
      provider: true,
      environment: true,
      providerSubscriptionId: true,
      providerPlanId: true,
      amount: true,
      currency: true,
      currentPeriodStart: true,
      currentPeriodEnd: true,
      cancelAtPeriodEnd: true,
      cancellationRequestedAt: true,
      updatedAt: true,
    },
  })
  assertFinancialIdentityUnchanged(local, sealSnapshot)
  if (candidate.status === 'active') {
    assertCancellationIntentUnchanged(local, sealSnapshot)
    if (sealSnapshot.cancelAtPeriodEnd) {
      const cancelled = await client.cancelSubscription(providerSubscriptionId)
      if (
        cancelled.id !== providerSubscriptionId ||
        cancelled.status !== 'canceled' ||
        cancelled.providerStatus !== 'canceled'
      ) {
        throw new SubscriptionReconciliationValidationError()
      }
      throw new SubscriptionReconciliationPartialError()
    }
  }
  if (candidate.status === 'canceled') {
    const result = await process({
      topic: 'subscription_preapproval',
      resourceId: candidate.id,
      liveMode: environment === 'production',
    })
    assertSafeProcessorOutcome(result)
    if (result.outcome === 'applied') applied++
    sealSnapshot = await dependencies.prisma.businessSubscription.findUnique({
      where: { id: local.id },
      select: {
        id: true,
        businessId: true,
        planId: true,
        interval: true,
        status: true,
        provider: true,
        environment: true,
        providerSubscriptionId: true,
        providerPlanId: true,
        amount: true,
        currency: true,
        currentPeriodStart: true,
        currentPeriodEnd: true,
        cancelAtPeriodEnd: true,
        cancellationRequestedAt: true,
        updatedAt: true,
      },
    })
    assertFinancialIdentityUnchanged(local, sealSnapshot)
  }
  if (!sealSnapshot) throw new SubscriptionReconciliationValidationError()

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
      status: sealSnapshot.status,
      currentPeriodStart: sealSnapshot.currentPeriodStart,
      currentPeriodEnd: sealSnapshot.currentPeriodEnd,
      cancelAtPeriodEnd: sealSnapshot.cancelAtPeriodEnd,
      cancellationRequestedAt: sealSnapshot.cancellationRequestedAt,
      updatedAt: sealSnapshot.updatedAt,
    },
    data: { lastReconciledAt: dependencies.now() },
  })
  if (marked.count !== 1) throw new SubscriptionReconciliationValidationError()
  return {
    outcome: 'reconciled',
    invoices: orderedInvoices.length,
    applied,
    providerTerminalCanceled: candidate.status === 'canceled',
  }
}
