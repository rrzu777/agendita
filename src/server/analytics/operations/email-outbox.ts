import 'server-only'
import { randomUUID } from 'node:crypto'
import { prisma } from '@/lib/db'
import { sendAnalyticsOperationalEmail } from '@/lib/notifications/email-provider'

const DELIVERY_LEASE_MS = 90 * 1000
const RETRY_DELAY_MS = 15 * 60 * 1000
const MAX_ATTEMPTS = 3
const IDEMPOTENCY_WINDOW_MS = 23 * 60 * 60 * 1000

export type DeliveryClaim = {
  id: string
  incidentId?: string | null
  notificationKind: string
  dedupeKey: string
  recipients: string[]
  subject: string
  htmlBody: string
  textBody: string
  leaseToken: string
  attempts: number
  firstProviderAttemptAt: Date
}

function recipientsFromJson(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.some((item) => typeof item !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(item))) throw new Error('invalid_delivery_recipients')
  return value
}

export async function claimAnalyticsEmailDelivery(now = new Date()): Promise<DeliveryClaim | null> {
  const row = await prisma.analyticsEmailDelivery.findFirst({
    where: {
      OR: [
        { status: 'pending', OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] },
        { status: 'failed', nextAttemptAt: { lte: now } },
        { status: 'ambiguous', nextAttemptAt: { lte: now } },
        { status: 'sending', leaseExpiresAt: { lt: now } },
      ],
    },
    orderBy: { createdAt: 'asc' },
  })
  if (!row) return null
  const leaseToken = randomUUID()
  const leaseExpiresAt = new Date(now.getTime() + DELIVERY_LEASE_MS)
  const updated = await prisma.analyticsEmailDelivery.updateMany({
    where: { id: row.id, OR: [{ status: 'pending' }, { status: 'failed' }, { status: 'ambiguous' }, { status: 'sending', leaseExpiresAt: { lt: now } }] },
    data: { status: 'sending', leaseToken, leaseExpiresAt, attempts: { increment: 1 }, firstProviderAttemptAt: row.firstProviderAttemptAt ?? now },
  })
  if (updated.count !== 1) return null
  return { id: row.id, incidentId: row.incidentId, notificationKind: row.notificationKind, dedupeKey: row.dedupeKey, recipients: recipientsFromJson(row.recipients), subject: row.subject, htmlBody: row.htmlBody, textBody: row.textBody, leaseToken, attempts: row.attempts + 1, firstProviderAttemptAt: row.firstProviderAttemptAt ?? now }
}

export async function deliverAnalyticsEmailClaim(claim: DeliveryClaim, now = new Date()): Promise<{ status: 'sent' | 'failed' | 'manual_review' | 'skipped'; messageId?: string }> {
  const result = await sendAnalyticsOperationalEmail({ to: claim.recipients, subject: claim.subject, html: claim.htmlBody, text: claim.textBody, idempotencyKey: claim.dedupeKey })
  if (result.success) {
    await prisma.analyticsEmailDelivery.updateMany({ where: { id: claim.id, leaseToken: claim.leaseToken, status: 'sending' }, data: { status: 'sent', sentAt: now, providerMessageId: result.messageId ?? null, leaseToken: null, leaseExpiresAt: null } })
    if (claim.incidentId) await prisma.analyticsOperationalIncident.update({ where: { id: claim.incidentId }, data: { lastNotificationStatus: 'sent', lastNotificationCode: claim.notificationKind } })
    return { status: 'sent', messageId: result.messageId }
  }
  const expired = now.getTime() - claim.firstProviderAttemptAt.getTime() >= IDEMPOTENCY_WINDOW_MS
  const terminal = claim.attempts >= MAX_ATTEMPTS || expired || result.errorCode === 'invalid_idempotent_request' || result.errorCode === 'invalid_idempotency_key'
  await prisma.analyticsEmailDelivery.updateMany({ where: { id: claim.id, leaseToken: claim.leaseToken, status: 'sending' }, data: { status: terminal ? 'manual_review' : result.errorCode === 'provider_ambiguous' ? 'ambiguous' : 'failed', nextAttemptAt: terminal ? null : new Date(now.getTime() + RETRY_DELAY_MS), lastFailureCode: result.errorCode ?? 'provider_failed', leaseToken: null, leaseExpiresAt: null } })
  if (claim.incidentId) await prisma.analyticsOperationalIncident.update({ where: { id: claim.incidentId }, data: { lastNotificationStatus: terminal ? 'failed' : result.errorCode === 'provider_ambiguous' ? 'pending' : 'failed', lastNotificationCode: result.errorCode ?? 'provider_failed' } })
  return { status: terminal ? 'manual_review' : 'failed' }
}

export async function drainAnalyticsEmailOutbox(input: { now?: Date; maxDeliveries?: number } = {}): Promise<{ sent: number; failed: number; pending: number }> {
  const now = input.now ?? new Date()
  const max = Math.min(input.maxDeliveries ?? 10, 25)
  let sent = 0
  let failed = 0
  for (let index = 0; index < max; index += 1) {
    const claim = await claimAnalyticsEmailDelivery(now)
    if (!claim) break
    const result = await deliverAnalyticsEmailClaim(claim, now)
    if (result.status === 'sent') sent += 1
    else failed += 1
  }
  const pending = await prisma.analyticsEmailDelivery.count({ where: { status: { in: ['pending', 'failed', 'ambiguous', 'sending'] } } })
  return { sent, failed, pending }
}
