import type { Prisma, PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db'
import { sendSubscriptionEmail } from './email-provider'
import {
  subscriptionNotificationHtml,
  subscriptionNotificationSubject,
  subscriptionNotificationText,
} from './templates'
import type {
  EmailResult,
  SubscriptionNotificationData,
  SubscriptionNotificationKind,
} from './types'

const DELIVERY_LEASE_MS = 5 * 60 * 1000
const RETRY_DELAY_MS = 60 * 1000
const RETRY_PAGE_SIZE = 20
const RESEND_IDEMPOTENCY_WINDOW_MS = 23 * 60 * 60 * 1000

const notificationKinds = new Set<SubscriptionNotificationKind>([
  'subscription_due_7_days',
  'subscription_due_3_days',
  'subscription_due_1_day',
  'subscription_activated',
  'subscription_payment_approved',
  'subscription_payment_failed',
  'subscription_recovered',
  'subscription_suspended',
  'subscription_cancellation_requested',
  'subscription_cancelled',
  'subscription_oauth_expired',
])
const scheduledBillingKinds = [
  'subscription_due_7_days',
  'subscription_due_3_days',
  'subscription_due_1_day',
] as const satisfies readonly SubscriptionNotificationKind[]
const scheduledBillingKindSet = new Set<SubscriptionNotificationKind>(scheduledBillingKinds)

export type SubscriptionNotificationDependencies = {
  prisma: PrismaClient | Prisma.TransactionClient
  sendEmail(input: {
    to: string[]
    subject: string
    html: string
    text: string
    idempotencyKey: string
  }): Promise<EmailResult>
  now(): Date
}

export type SubscriptionNotificationResult = {
  status: 'sent' | 'failed' | 'skipped'
}

function runtimeDependencies(): SubscriptionNotificationDependencies {
  return { prisma, sendEmail: sendSubscriptionEmail, now: () => new Date() }
}

export function subscriptionNotificationDedupeKey(
  subscriptionId: string,
  kind: SubscriptionNotificationKind,
  effectiveDate: Date,
  eventId?: string,
): string {
  return `${subscriptionId}:${kind}:${eventId ?? effectiveDate.toISOString()}`
}

export function buildSubscriptionNotification(
  kind: SubscriptionNotificationKind,
  data: Required<Pick<SubscriptionNotificationData, 'businessName' | 'effectiveDate'>>,
) {
  return {
    subject: subscriptionNotificationSubject(kind, data),
    html: subscriptionNotificationHtml(kind, data),
    text: subscriptionNotificationText(kind, data),
  }
}

export async function queueSubscriptionNotification(
  kind: SubscriptionNotificationKind,
  data: SubscriptionNotificationData,
  dependencies: Pick<SubscriptionNotificationDependencies, 'prisma' | 'now'> = runtimeDependencies(),
): Promise<void> {
  const now = dependencies.now()
  const eventAt = data.eventAt ?? now
  const availableAt = data.availableAt ?? now
  const business = await dependencies.prisma.business.findUnique({
    where: { id: data.businessId },
    select: {
      name: true,
      users: { where: { role: { in: ['owner', 'admin'] } }, select: { user: { select: { email: true } } } },
    },
  })
  if (!business) throw new Error('Subscription notification business is missing.')
  const recipientEmails = [...new Set(business.users.map(({ user }) => user.email))]
    .sort((left, right) => left.localeCompare(right))
  await dependencies.prisma.subscriptionNotificationDelivery.createMany({
    data: [{
      businessId: data.businessId,
      subscriptionId: data.subscriptionId,
      kind,
      effectiveDate: data.effectiveDate,
      eventAt,
      availableAt,
      eventId: data.eventId,
      dedupeKey: subscriptionNotificationDedupeKey(data.subscriptionId, kind, data.effectiveDate, data.eventId),
      nextAttemptAt: availableAt,
      recipientEmails,
      businessNameSnapshot: data.businessName ?? business.name,
    }],
    skipDuplicates: true,
  })
}

function isSubscriptionNotificationKind(value: string): value is SubscriptionNotificationKind {
  return notificationKinds.has(value as SubscriptionNotificationKind)
}

async function markDelivery(
  dependencies: SubscriptionNotificationDependencies,
  input: {
    dedupeKey: string
    leaseUntil: Date
    status: 'sent' | 'failed' | 'manual_review'
    now: Date
    errorCode?: string
    terminal?: boolean
  },
): Promise<void> {
  await dependencies.prisma.subscriptionNotificationDelivery.updateMany({
    where: {
      dedupeKey: input.dedupeKey,
      status: 'pending',
      nextAttemptAt: input.leaseUntil,
    },
    data: input.status === 'sent'
      ? { status: 'sent', sentAt: input.now, nextAttemptAt: null, lastErrorCode: null }
      : input.status === 'manual_review'
        ? { status: 'manual_review', manualReviewAt: input.now, nextAttemptAt: null, lastErrorCode: input.errorCode ?? 'manual_review' }
      : {
          status: 'failed',
          nextAttemptAt: input.terminal ? null : new Date(input.now.getTime() + RETRY_DELAY_MS),
          lastErrorCode: input.errorCode ?? 'send_failed',
        },
  })
}

/**
 * Persiste antes de enviar, reclama por lease con CAS y usa la misma clave en
 * Resend. Si la respuesta se pierde tras el envío, el reintento es seguro para
 * el proveedor y nunca se reenvía una entrega ya marcada como `sent`.
 */
export async function sendSubscriptionNotification(
  kind: SubscriptionNotificationKind,
  data: SubscriptionNotificationData,
  dependencies: SubscriptionNotificationDependencies = runtimeDependencies(),
): Promise<SubscriptionNotificationResult> {
  const now = dependencies.now()
  const dedupeKey = subscriptionNotificationDedupeKey(data.subscriptionId, kind, data.effectiveDate, data.eventId)
  await queueSubscriptionNotification(kind, data, dependencies)

  const before = await dependencies.prisma.subscriptionNotificationDelivery.findUnique({
    where: { dedupeKey },
    select: { firstProviderAttemptAt: true },
  })
  if (before?.firstProviderAttemptAt && now.getTime() - before.firstProviderAttemptAt.getTime() >= RESEND_IDEMPOTENCY_WINDOW_MS) {
    await dependencies.prisma.subscriptionNotificationDelivery.updateMany({
      where: { dedupeKey, status: { in: ['pending', 'failed'] } },
      data: { status: 'manual_review', manualReviewAt: now, nextAttemptAt: null, lastErrorCode: 'idempotency_window_elapsed' },
    })
    return { status: 'skipped' }
  }

  const leaseUntil = new Date(now.getTime() + DELIVERY_LEASE_MS)
  const scheduled = scheduledBillingKindSet.has(kind)
  const claim = await dependencies.prisma.subscriptionNotificationDelivery.updateMany({
    where: {
      dedupeKey,
      ...(scheduled ? { subscription: { billingEnabled: true } } : {}),
      OR: [
        { status: 'pending', OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] },
        { status: 'failed', nextAttemptAt: { lte: now } },
      ],
    },
    data: {
      status: 'pending',
      attempts: { increment: 1 },
      nextAttemptAt: leaseUntil,
      firstProviderAttemptAt: before?.firstProviderAttemptAt ?? now,
    },
  })
  if (claim.count !== 1) return { status: 'skipped' }

  const deliveryRecord = await dependencies.prisma.subscriptionNotificationDelivery.findUnique({
    where: { dedupeKey },
    select: { recipientEmails: true, businessNameSnapshot: true },
  })
  const recipients = deliveryRecord?.recipientEmails ?? []
  if (!deliveryRecord || recipients.length === 0) {
    await markDelivery(dependencies, { dedupeKey, leaseUntil, status: 'failed', now, errorCode: 'recipient_unavailable' })
    return { status: 'failed' }
  }

  const notification = buildSubscriptionNotification(kind, {
    businessName: deliveryRecord.businessNameSnapshot,
    effectiveDate: data.effectiveDate,
  })
  const delivery = await dependencies.sendEmail({ ...notification, to: recipients, idempotencyKey: dedupeKey })
  if (!delivery.success) {
    const terminalIdempotencyFailure = delivery.errorCode === 'invalid_idempotent_request' ||
      delivery.errorCode === 'invalid_idempotency_key'
    await markDelivery(dependencies, {
      dedupeKey,
      leaseUntil,
      status: terminalIdempotencyFailure ? 'manual_review' : 'failed',
      now,
      ...(terminalIdempotencyFailure ? { errorCode: 'idempotency_conflict', terminal: true } : {}),
    })
    return { status: 'failed' }
  }

  await markDelivery(dependencies, { dedupeKey, leaseUntil, status: 'sent', now })
  return { status: 'sent' }
}

export async function retrySubscriptionNotifications(
  input: { now: Date },
  dependencies: SubscriptionNotificationDependencies = runtimeDependencies(),
): Promise<SubscriptionNotificationResult[]> {
  await dependencies.prisma.subscriptionNotificationDelivery.updateMany({
    where: {
      kind: { in: [...scheduledBillingKinds] },
      status: { in: ['failed', 'pending'] },
      subscription: { billingEnabled: false },
    },
    data: {
      status: 'suppressed',
      nextAttemptAt: null,
      lastErrorCode: 'billing_disabled',
    },
  })
  const deliveries = await dependencies.prisma.subscriptionNotificationDelivery.findMany({
    where: {
      status: { in: ['failed', 'pending'] },
      nextAttemptAt: { lte: input.now },
      availableAt: { lte: input.now },
      OR: [
        { kind: { notIn: [...scheduledBillingKinds] } },
        { subscription: { billingEnabled: true } },
      ],
    },
    orderBy: [{ nextAttemptAt: 'asc' }, { id: 'asc' }],
    take: RETRY_PAGE_SIZE,
    select: { businessId: true, subscriptionId: true, kind: true, effectiveDate: true, eventAt: true, availableAt: true, eventId: true },
  })
  const results: SubscriptionNotificationResult[] = []
  for (const delivery of deliveries) {
    if (!isSubscriptionNotificationKind(delivery.kind)) continue
    results.push(await sendSubscriptionNotification(delivery.kind, {
      ...delivery,
      eventId: delivery.eventId ?? undefined,
    }, dependencies))
  }
  return results
}

export { type SubscriptionNotificationData, type SubscriptionNotificationKind }
