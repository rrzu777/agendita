import 'server-only'
import { createHash } from 'node:crypto'
import { randomUUID } from 'node:crypto'
import { prisma } from '@/lib/db'
import { sendAnalyticsOperationalEmail } from '@/lib/notifications/email-provider'

const DELIVERY_LEASE_MS = 90 * 1000
const RETRY_DELAY_MS = 15 * 60 * 1000
const MAX_ATTEMPTS = 3
const IDEMPOTENCY_WINDOW_MS = 23 * 60 * 60 * 1000

export const OPERATIONAL_NOTIFICATION_KINDS = ['alert_open', 'alert_escalation', 'alert_reminder', 'alert_beyond_tolerance', 'alert_resolved'] as const
type NotificationKind = typeof OPERATIONAL_NOTIFICATION_KINDS[number] | 'weekly_digest'

export type DeliveryClaim = {
  id: string
  incidentId?: string | null
  weeklyInsightId?: string | null
  recipientUserId?: string | null
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

export async function claimAnalyticsEmailDelivery(now = new Date(), notificationKinds?: readonly NotificationKind[]): Promise<DeliveryClaim | null> {
  const row = await prisma.analyticsEmailDelivery.findFirst({
    where: {
      notificationKind: notificationKinds ? { in: [...notificationKinds] } : undefined,
      OR: [
        { status: 'pending', OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] },
        { status: 'failed', nextAttemptAt: { lte: now } },
        { status: 'ambiguous', nextAttemptAt: { lte: now } },
        { status: 'sending', leaseExpiresAt: { lt: now } },
      ],
    },
    orderBy: { createdAt: 'asc' },
    include: { weeklyInsight: { select: { businessId: true } } },
  })
  if (!row) return null
  if (row.weeklyInsightId) {
    const businessId = row.weeklyInsight?.businessId
    const [preference, membership] = row.recipientUserId && businessId
      ? await Promise.all([
          prisma.analyticsInsightPreference.findUnique({ where: { businessId }, select: { enabled: true, emailEnabled: true, recipientUserId: true } }),
          prisma.businessUser.findFirst({ where: { businessId, userId: row.recipientUserId, role: { in: ['owner', 'admin'] } }, select: { id: true, user: { select: { email: true } } } }),
        ])
      : [null, null]
    const frozenEmail = recipientsFromJson(row.recipients)[0]?.trim().toLowerCase()
    const currentEmail = membership && 'user' in membership && membership.user?.email ? membership.user.email.trim().toLowerCase() : null
    if (!preference?.enabled || !preference.emailEnabled || preference.recipientUserId !== row.recipientUserId || !membership || !currentEmail || currentEmail !== frozenEmail) {
      await prisma.analyticsEmailDelivery.updateMany({ where: { id: row.id, status: row.status }, data: { status: 'cancelled', leaseToken: null, leaseExpiresAt: null } })
      return null
    }
  }
  const leaseToken = randomUUID()
  const leaseExpiresAt = new Date(now.getTime() + DELIVERY_LEASE_MS)
  const updated = await prisma.analyticsEmailDelivery.updateMany({
    where: { id: row.id, OR: [{ status: 'pending' }, { status: 'failed' }, { status: 'ambiguous' }, { status: 'sending', leaseExpiresAt: { lt: now } }] },
    data: { status: 'sending', leaseToken, leaseExpiresAt, attempts: { increment: 1 }, firstProviderAttemptAt: row.firstProviderAttemptAt ?? now },
  })
  if (updated.count !== 1) return null
  return { id: row.id, incidentId: row.incidentId, weeklyInsightId: row.weeklyInsightId, recipientUserId: row.recipientUserId, notificationKind: row.notificationKind, dedupeKey: row.dedupeKey, recipients: recipientsFromJson(row.recipients), subject: row.subject, htmlBody: row.htmlBody, textBody: row.textBody, leaseToken, attempts: row.attempts + 1, firstProviderAttemptAt: row.firstProviderAttemptAt ?? now }
}

export async function queueWeeklyInsightDigest(input: { weeklyInsightId: string; recipientUserId: string; recipientEmail: string; now?: Date }): Promise<boolean> {
  const insight = await prisma.analyticsWeeklyInsight.findUnique({ where: { id: input.weeklyInsightId }, select: { id: true, facts: true, narrative: true, sourceExpiresAt: true } })
  if (!insight || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.recipientEmail)) return false
  const now = input.now ?? new Date()
  const facts = insight.facts && typeof insight.facts === 'object' ? insight.facts as { conversion?: { numerator?: number; denominator?: number }; matureCompleteAttempts?: number } : {}
  const narrative = insight.narrative && typeof insight.narrative === 'object' ? insight.narrative as { summary?: string } : null
  const subject = '[Agendita] Resumen semanal de métricas'
  const summary = narrative?.summary?.replace(/[<>]/g, '') || `Intentos completos maduros: ${facts.matureCompleteAttempts ?? 0}. Conversión: ${facts.conversion?.numerator ?? 0} de ${facts.conversion?.denominator ?? 0}.`
  const textBody = `${subject}\n\n${summary}`
  try {
    await prisma.analyticsEmailDelivery.create({ data: { weeklyInsightId: insight.id, recipientUserId: input.recipientUserId, dedupeKey: `analytics-weekly:${insight.id}:weekly_digest`, notificationKind: 'weekly_digest', payloadHash: createHash('sha256').update(JSON.stringify({ recipientEmail: input.recipientEmail, subject, textBody })).digest('hex'), recipients: [input.recipientEmail], subject, htmlBody: `<p>${summary}</p>`, textBody, retentionExpiresAt: new Date(Math.min(insight.sourceExpiresAt.getTime(), now.getTime() + 90 * 24 * 60 * 60 * 1000)) } })
    return true
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'P2002') return false
    throw error
  }
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

export async function drainAnalyticsEmailOutbox(input: { now?: Date; maxDeliveries?: number; notificationKinds?: readonly NotificationKind[] } = {}): Promise<{ sent: number; failed: number; pending: number }> {
  const now = input.now ?? new Date()
  const max = Math.min(input.maxDeliveries ?? 10, 25)
  let sent = 0
  let failed = 0
  for (let index = 0; index < max; index += 1) {
    const claim = await claimAnalyticsEmailDelivery(now, input.notificationKinds)
    if (!claim) break
    const result = await deliverAnalyticsEmailClaim(claim, now)
    if (result.status === 'sent') sent += 1
    else failed += 1
  }
  const pending = await prisma.analyticsEmailDelivery.count({ where: { status: { in: ['pending', 'failed', 'ambiguous', 'sending'] } } })
  return { sent, failed, pending }
}
