import type { PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db'
import type { MercadoPagoEnvironment } from '@/lib/payments/mercado-pago-environment'
import type { MpSubscriptionClient } from './mercado-pago-client'
import type { MpInvoice, MpSubscription } from './mercado-pago-mappers'
import {
  getSubscriptionWebhookRuntime,
  processSubscriptionWebhook,
  type SubscriptionWebhookEvent,
} from './webhook'
import { findExistingProviderPaymentClaim } from './transition'

export type ReconciliationDependencies = {
  prisma: PrismaClient
  getProcessor(environment: MercadoPagoEnvironment): {
    client: Pick<MpSubscriptionClient, 'getSubscription' | 'searchInvoices'>
    process(event: SubscriptionWebhookEvent): Promise<{ outcome: string; status?: string }>
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

function assertSubscriptionSnapshot(
  local: {
    providerSubscriptionId: string
    providerPlanId: string | null
    amount: number
    currency: string
  },
  candidate: MpSubscription,
): void {
  if (
    candidate.id !== local.providerSubscriptionId ||
    !candidate.planId ||
    candidate.planId !== local.providerPlanId ||
    !candidate.externalReference ||
    candidate.amount !== local.amount ||
    candidate.currency !== local.currency ||
    candidate.frequency !== 1 ||
    candidate.frequencyType !== 'months'
  ) {
    throw new SubscriptionReconciliationValidationError()
  }
}

function assertInvoiceSnapshot(candidate: MpSubscription, invoice: MpInvoice): void {
  if (
    invoice.subscriptionId !== candidate.id ||
    !invoice.externalReference ||
    invoice.externalReference !== candidate.externalReference ||
    invoice.amount !== candidate.amount ||
    invoice.currency !== candidate.currency ||
    (invoice.status === 'approved' && (!invoice.providerPaymentId || !invoice.approvedAt)) ||
    (invoice.status === 'failed' && !invoice.debitAt && !invoice.createdAt)
  ) {
    throw new SubscriptionReconciliationValidationError()
  }
}

function invoiceTime(invoice: MpInvoice): number {
  return (invoice.debitAt ?? invoice.approvedAt ?? invoice.createdAt ?? invoice.updatedAt)?.getTime() ?? 0
}

function terminalInvoice(
  candidate: MpSubscription,
  invoices: MpInvoice[],
  currentPeriodEnd: Date,
  validateCycle: boolean,
): MpInvoice | null {
  if (invoices.length === 0) return null
  const ordered = [...invoices].sort((left, right) => invoiceTime(left) - invoiceTime(right))
  const latest = ordered.at(-1)!
  if (invoiceTime(latest) === 0) throw new SubscriptionReconciliationValidationError()
  if (latest.status !== 'approved' && latest.status !== 'failed') {
    throw new SubscriptionReconciliationValidationError()
  }
  if (latest.status === 'approved' && validateCycle) {
    if (!latest.approvedAt || !candidate.nextPaymentAt) {
      throw new SubscriptionReconciliationValidationError()
    }
    const hasMonthlyAnchor = [latest.debitAt, currentPeriodEnd].some((anchor) => {
      if (!anchor) return false
      const cycleDays = (
        candidate.nextPaymentAt!.getTime() - anchor.getTime()
      ) / (24 * 60 * 60 * 1000)
      return cycleDays >= 27 && cycleDays <= 32
    })
    if (!hasMonthlyAnchor) {
      throw new SubscriptionReconciliationValidationError()
    }
  }
  return latest
}

async function assertCanceledSettlementsClaimed(input: {
  dependencies: ReconciliationDependencies
  invoices: MpInvoice[]
  local: {
    id: string
    businessId: string
    environment: MercadoPagoEnvironment
    lastPaidAt: Date | null
  }
}) {
  const { dependencies, invoices, local } = input
  const approvalsToVerify = invoices.filter((invoice) =>
    invoice.status === 'approved' &&
    invoice.approvedAt &&
    (!local.lastPaidAt || invoice.approvedAt.getTime() > local.lastPaidAt.getTime()),
  )
  const claims = await Promise.all(approvalsToVerify.map((invoice) =>
    findExistingProviderPaymentClaim(dependencies.prisma, {
      provider: 'mercado_pago',
      environment: local.environment,
      providerPaymentId: invoice.providerPaymentId ?? undefined,
      providerInvoiceId: invoice.id,
      subscriptionId: local.id,
      businessId: local.businessId,
    }),
  ))
  if (claims.some((claim) => !claim)) throw new SubscriptionReconciliationValidationError()
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
      status: true,
      provider: true,
      environment: true,
      providerSubscriptionId: true,
      providerPlanId: true,
      amount: true,
      currency: true,
      currentPeriodEnd: true,
      lastPaidAt: true,
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

  const { client, process } = dependencies.getProcessor(local.environment)
  const [candidate, invoices] = await Promise.all([
    client.getSubscription(local.providerSubscriptionId),
    client.searchInvoices(local.providerSubscriptionId),
  ])
  assertSubscriptionSnapshot({
    providerSubscriptionId: local.providerSubscriptionId,
    providerPlanId: local.providerPlanId,
    amount: local.amount,
    currency: local.currency,
  }, candidate)

  for (const invoice of invoices) assertInvoiceSnapshot(candidate, invoice)
  if (candidate.status === 'canceled') {
    await assertCanceledSettlementsClaimed({
      dependencies,
      invoices,
      local: {
        id: local.id,
        businessId: local.businessId,
        environment: local.environment,
        lastPaidAt: local.lastPaidAt,
      },
    })
  }
  const terminal = terminalInvoice(
    candidate,
    invoices,
    local.currentPeriodEnd,
    candidate.status !== 'canceled',
  )
  const actionable = terminal && candidate.status !== 'canceled' ? [terminal] : []

  let applied = 0
  for (const invoice of actionable) {
    const result = await process({
      topic: 'subscription_authorized_payment',
      resourceId: invoice.id,
      liveMode: local.environment === 'production',
    })
    if (result.outcome === 'applied') applied++
  }
  if (candidate.status === 'canceled') {
    const result = await process({
      topic: 'subscription_preapproval',
      resourceId: candidate.id,
      liveMode: local.environment === 'production',
    })
    if (result.outcome === 'applied') applied++
  }

  await dependencies.prisma.businessSubscription.update({
    where: { id: local.id },
    data: { lastReconciledAt: dependencies.now() },
  })
  return { outcome: 'reconciled', invoices: actionable.length, applied }
}
