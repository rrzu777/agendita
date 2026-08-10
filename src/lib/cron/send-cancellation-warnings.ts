import { BookingStatus } from '@prisma/client'
import { cancellationWarningText } from '@/lib/bookings/cancellation-policy'
import { getAppUrl, getBookingConfirmationUrl } from '@/lib/business/urls'
import { prisma } from '@/lib/db'
import { logger } from '@/lib/logger'
import { decryptSecret } from '@/lib/payments/encryption'
import { hasCompletePushConfig } from '@/lib/push/routes'
import { normalizePushSubscription } from '@/lib/push/subscription'
import { sendWebPush, type WebPushResult } from '@/lib/push/web-push'

const HOUR_MS = 60 * 60 * 1000
const WARNING_LEAD_HOURS = 2
const MAX_CUTOFF_HOURS = 720
const LEASE_MS = 10 * 60 * 1000
const QUERY_BATCH_SIZE = 100

export interface SendCancellationWarningsResult {
  sent: number
  skipped: number
  errors: number
}

export function cancellationWarningWindow(
  startDateTime: Date,
  cutoffHours: number,
): { targetAt: Date; closesAt: Date } {
  if (!Number.isSafeInteger(cutoffHours) || cutoffHours < 0) {
    throw new RangeError('cutoffHours must be a non-negative safe integer')
  }
  const startMs = startDateTime.getTime()
  const cutoffMs = cutoffHours * HOUR_MS
  const closesAtMs = startMs - cutoffMs
  const targetAtMs = closesAtMs - WARNING_LEAD_HOURS * HOUR_MS
  if (
    !Number.isSafeInteger(startMs)
    || !Number.isSafeInteger(cutoffMs)
    || !Number.isSafeInteger(closesAtMs)
    || !Number.isSafeInteger(targetAtMs)
  ) {
    throw new RangeError('Cancellation warning window exceeds exact millisecond arithmetic')
  }
  return {
    targetAt: new Date(targetAtMs),
    closesAt: new Date(closesAtMs),
  }
}

type Candidate = Awaited<ReturnType<typeof loadCandidateBatch>>[number]
type Subscription = Awaited<ReturnType<typeof loadActiveSubscriptions>>[number]

type DeliveryDisposition =
  | { kind: 'success'; subscription: Subscription }
  | { kind: 'gone'; subscription: Subscription }
  | { kind: 'permanent'; subscription: Subscription }
  | { kind: 'transient'; subscription: Subscription }

function candidateCutoffHours(candidate: Candidate): number {
  return candidate.cancellationCutoffHours
    ?? candidate.business.selfServiceCutoffHours
}

function isInsideWarningWindow(candidate: Candidate, now: Date): boolean {
  const cutoffHours = candidateCutoffHours(candidate)
  return isCutoffInsideWarningWindow(candidate.startDateTime, cutoffHours, now)
}

function isCutoffInsideWarningWindow(
  startDateTime: Date,
  cutoffHours: number,
  now: Date,
): boolean {
  if (
    !Number.isSafeInteger(cutoffHours)
    || cutoffHours <= 0
    || cutoffHours > MAX_CUTOFF_HOURS
  ) {
    return false
  }

  const { targetAt, closesAt } = cancellationWarningWindow(
    startDateTime,
    cutoffHours,
  )
  const nowMs = now.getTime()
  return nowMs >= targetAt.getTime() && nowMs < closesAt.getTime()
}

async function revalidateLegacyCutoff(
  candidate: Candidate,
  now: Date,
): Promise<number | null> {
  const current = await prisma.booking.findUnique({
    where: { id: candidate.id },
    select: {
      cancellationCutoffHours: true,
      startDateTime: true,
      business: {
        select: {
          selfServiceCutoffHours: true,
          cancellationReminderEnabled: true,
        },
      },
    },
  })
  if (!current?.business.cancellationReminderEnabled) return null

  const cutoffHours = current.cancellationCutoffHours
    ?? current.business.selfServiceCutoffHours
  return isCutoffInsideWarningWindow(current.startDateTime, cutoffHours, now)
    ? cutoffHours
    : null
}

function candidateWhere(now: Date) {
  const staleBefore = new Date(now.getTime() - LEASE_MS)
  return {
    status: BookingStatus.confirmed,
    depositPaid: { gt: 0 },
    cancellationReminderSentAt: null,
    startDateTime: {
      gt: now,
      lte: new Date(now.getTime() + (MAX_CUTOFF_HOURS + WARNING_LEAD_HOURS) * HOUR_MS),
    },
    business: { cancellationReminderEnabled: true },
    OR: [
      { cancellationReminderClaimedAt: null },
      { cancellationReminderClaimedAt: { lt: staleBefore } },
    ],
  }
}

async function loadCandidateBatch(now: Date, cursor?: string) {
  return prisma.booking.findMany({
    where: candidateWhere(now),
    select: {
      id: true,
      customerId: true,
      startDateTime: true,
      cancellationCutoffHours: true,
      customer: { select: { userId: true } },
      business: {
        select: {
          id: true,
          name: true,
          slug: true,
          subdomain: true,
          selfServiceCutoffHours: true,
        },
      },
    },
    orderBy: { id: 'asc' },
    take: QUERY_BATCH_SIZE,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  })
}

async function loadActiveSubscriptions(candidate: Candidate) {
  return prisma.pushSubscription.findMany({
    where: {
      businessId: candidate.business.id,
      customerId: candidate.customerId,
      revokedAt: null,
    },
    select: {
      id: true,
      subscriptionEncrypted: true,
      failureCount: true,
    },
  })
}

function pushDestination(candidate: Candidate): string {
  if (candidate.customer.userId) {
    return getAppUrl(`/mi/${candidate.business.slug}`)
  }
  return getBookingConfirmationUrl(candidate.business, candidate.id)
}

function classifyDelivery(
  subscription: Subscription,
  delivery: WebPushResult,
): DeliveryDisposition {
  if (delivery.ok) return { kind: 'success', subscription }
  if (delivery.statusCode === 404 || delivery.statusCode === 410) {
    return { kind: 'gone', subscription }
  }
  if (
    delivery.statusCode === 400
    || delivery.statusCode === 401
    || delivery.statusCode === 403
  ) {
    return { kind: 'permanent', subscription }
  }
  return { kind: 'transient', subscription }
}

async function persistDisposition(disposition: DeliveryDisposition, now: Date): Promise<void> {
  const { subscription } = disposition
  const deliveredGeneration = {
    id: subscription.id,
    subscriptionEncrypted: subscription.subscriptionEncrypted,
    revokedAt: null,
  }
  if (disposition.kind === 'success') {
    await prisma.pushSubscription.updateMany({
      where: deliveredGeneration,
      data: {
        failureCount: 0,
        lastFailureAt: null,
        lastSuccessAt: now,
      },
    })
    return
  }

  if (disposition.kind === 'gone') {
    await prisma.pushSubscription.updateMany({
      where: deliveredGeneration,
      data: {
        revokedAt: now,
        lastFailureAt: now,
        failureCount: { increment: 1 },
      },
    })
    return
  }

  if (disposition.kind === 'permanent') {
    await prisma.pushSubscription.updateMany({
      where: {
        ...deliveredGeneration,
        failureCount: subscription.failureCount,
      },
      data: {
        failureCount: { increment: 1 },
        lastFailureAt: now,
        ...(subscription.failureCount >= 2 ? { revokedAt: now } : {}),
      },
    })
    return
  }

  await prisma.pushSubscription.updateMany({
    where: deliveredGeneration,
    data: { lastFailureAt: now },
  })
}

function releaseClaim(bookingId: string, now: Date) {
  return prisma.booking.updateMany({
    where: {
      id: bookingId,
      cancellationReminderClaimedAt: now,
      cancellationReminderSentAt: null,
    },
    data: { cancellationReminderClaimedAt: null },
  })
}

async function processCandidate(
  candidate: Candidate,
  now: Date,
): Promise<'sent' | 'skipped' | 'error'> {
  if (!isInsideWarningWindow(candidate, now)) return 'skipped'

  const staleBefore = new Date(now.getTime() - LEASE_MS)
  let claimOpen = false
  try {
    const claim = await prisma.booking.updateMany({
      where: {
        id: candidate.id,
        status: BookingStatus.confirmed,
        depositPaid: { gt: 0 },
        startDateTime: candidate.startDateTime,
        cancellationReminderSentAt: null,
        business: { cancellationReminderEnabled: true },
        OR: [
          { cancellationReminderClaimedAt: null },
          { cancellationReminderClaimedAt: { lt: staleBefore } },
        ],
      },
      data: { cancellationReminderClaimedAt: now },
    })
    if (claim.count === 0) return 'skipped'
    claimOpen = true

    let cutoffHours = candidateCutoffHours(candidate)
    if (candidate.cancellationCutoffHours === null) {
      const currentCutoffHours = await revalidateLegacyCutoff(candidate, now)
      if (currentCutoffHours === null) {
        await releaseClaim(candidate.id, now)
        claimOpen = false
        return 'skipped'
      }
      cutoffHours = currentCutoffHours
    }

    const subscriptions = await loadActiveSubscriptions(candidate)
    if (subscriptions.length === 0) {
      await releaseClaim(candidate.id, now)
      claimOpen = false
      return 'skipped'
    }

    const body = cancellationWarningText(cutoffHours)
    if (!body) {
      await releaseClaim(candidate.id, now)
      claimOpen = false
      return 'skipped'
    }
    const payload = {
      title: candidate.business.name,
      body,
      url: pushDestination(candidate),
    }

    const settledDeliveries = await Promise.allSettled(
      subscriptions.map(async (subscription) => {
        // The capability URL and browser keys stay encrypted until this worker
        // wins the booking lease. Losing concurrent workers never decrypt them.
        const normalized = normalizePushSubscription(
          JSON.parse(decryptSecret(subscription.subscriptionEncrypted)) as unknown,
        )
        const delivery = await sendWebPush(normalized, payload)
        return classifyDelivery(subscription, delivery)
      }),
    )

    const dispositions: DeliveryDisposition[] = []
    for (let index = 0; index < settledDeliveries.length; index++) {
      const settled = settledDeliveries[index]
      dispositions.push(
        settled.status === 'fulfilled'
          ? settled.value
          : { kind: 'transient', subscription: subscriptions[index] },
      )
    }

    const counts = {
      success: dispositions.filter(({ kind }) => kind === 'success').length,
      gone: dispositions.filter(({ kind }) => kind === 'gone').length,
      permanent: dispositions.filter(({ kind }) => kind === 'permanent').length,
      transient: dispositions.filter(({ kind }) => kind === 'transient').length,
    }

    let stateError = false
    try {
      if (counts.success > 0) {
        const finalized = await prisma.booking.updateMany({
          where: {
            id: candidate.id,
            cancellationReminderClaimedAt: now,
            cancellationReminderSentAt: null,
          },
          data: {
            cancellationReminderSentAt: now,
            cancellationReminderClaimedAt: null,
          },
        })
        stateError = finalized.count === 0
      } else {
        await releaseClaim(candidate.id, now)
      }
      claimOpen = false
    } catch {
      stateError = true
    }

    const persistence = await Promise.allSettled(
      dispositions.map((disposition) => persistDisposition(disposition, now)),
    )
    const persistenceErrors = persistence.filter(({ status }) => status === 'rejected').length
    if (persistenceErrors > 0) stateError = true

    const logExtra = {
      bookingId: candidate.id,
      businessId: candidate.business.id,
      metadata: { ...counts, persistenceErrors },
    }
    if (counts.success > 0 && !stateError) {
      logger.info(
        'booking.cancellation_warning_sent',
        'Cancellation warning delivery completed',
        logExtra,
      )
      return 'sent'
    }

    logger.error(
      'booking.cancellation_warning_failed',
      'Cancellation warning delivery failed',
      logExtra,
    )
    return 'error'
  } catch (error) {
    if (claimOpen) {
      try {
        await releaseClaim(candidate.id, now)
      } catch {
        // Keep the original, sanitized failure path. The lease is recoverable.
      }
    }
    throw error
  }
}

export async function sendCancellationWarnings(
  now: Date = new Date(),
): Promise<SendCancellationWarningsResult> {
  const result: SendCancellationWarningsResult = { sent: 0, skipped: 0, errors: 0 }
  if (!hasCompletePushConfig()) return result

  let cursor: string | undefined

  do {
    const candidates = await loadCandidateBatch(now, cursor)
    for (const candidate of candidates) {
      try {
        const outcome = await processCandidate(candidate, now)
        result[outcome === 'error' ? 'errors' : outcome]++
      } catch {
        logger.error(
          'booking.cancellation_warning_failed',
          'Cancellation warning processing failed',
          { bookingId: candidate.id, businessId: candidate.business.id },
        )
        result.errors++
      }
    }

    if (candidates.length < QUERY_BATCH_SIZE) break
    cursor = candidates.at(-1)?.id
  } while (cursor)

  return result
}
