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
const MAX_ACTIVE_SUBSCRIPTIONS = 5
const DELIVERY_CONCURRENCY = 2
const GENERATION_DELIVERY_ATTEMPTS = 2

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
type Clock = () => Date

type DeliveryDisposition =
  | { kind: 'success'; subscription: Subscription; occurredAt: Date }
  | { kind: 'gone'; subscription: Subscription; occurredAt: Date }
  | { kind: 'permanent'; subscription: Subscription; occurredAt: Date }
  | { kind: 'transient'; subscription: Subscription; occurredAt: Date }
  | { kind: 'invalid'; subscription: Subscription; occurredAt: Date }

type DeliveryAttempt =
  | DeliveryDisposition
  | { kind: 'expired'; subscription: Subscription }

async function mapSettledBounded<T, R>(
  items: readonly T[],
  concurrency: number,
  operation: (item: T, index: number) => Promise<R>,
): Promise<Array<PromiseSettledResult<R>>> {
  const results = new Array<PromiseSettledResult<R>>(items.length)
  let nextIndex = 0

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex++
      try {
        results[index] = { status: 'fulfilled', value: await operation(items[index], index) }
      } catch (reason) {
        results[index] = { status: 'rejected', reason }
      }
    }
  }

  const workerCount = Math.min(Math.max(1, concurrency), items.length)
  await Promise.allSettled(Array.from({ length: workerCount }, () => worker()))
  return results
}

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

async function revalidateClaimedCandidate(
  bookingId: string,
  claimedAt: Date,
  currentTime: Date,
): Promise<{
  cutoffHours: number
  startDateTime: Date
  userId: string | null
} | null> {
  const current = await prisma.booking.findFirst({
    where: {
      id: bookingId,
      cancellationReminderClaimedAt: claimedAt,
      cancellationReminderSentAt: null,
      status: BookingStatus.confirmed,
      depositPaid: { gt: 0 },
      startDateTime: { gt: currentTime },
      business: { cancellationReminderEnabled: true },
    },
    select: {
      cancellationCutoffHours: true,
      startDateTime: true,
      customer: { select: { userId: true } },
      business: { select: { selfServiceCutoffHours: true } },
    },
  })
  if (!current) return null

  const cutoffHours = current.cancellationCutoffHours
    ?? current.business.selfServiceCutoffHours
  return isCutoffInsideWarningWindow(current.startDateTime, cutoffHours, currentTime)
    ? {
        cutoffHours,
        startDateTime: current.startDateTime,
        userId: current.customer.userId,
      }
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
  const bookingEntitlement = {
    bookingEntitlements: { some: { bookingId: candidate.id } },
  }
  return prisma.pushSubscription.findMany({
    where: {
      businessId: candidate.business.id,
      customerId: candidate.customerId,
      revokedAt: null,
      ...(candidate.customer.userId
        ? {
            OR: [
              bookingEntitlement,
              { authorizedUserId: candidate.customer.userId },
            ],
          }
        : bookingEntitlement),
    },
    select: {
      id: true,
      authorizedUserId: true,
      subscriptionFingerprint: true,
      subscriptionEncrypted: true,
      failureCount: true,
    },
    orderBy: { updatedAt: 'desc' },
    take: MAX_ACTIVE_SUBSCRIPTIONS,
  })
}

function pushDestination(candidate: Candidate, subscription: Subscription): string {
  if (
    candidate.customer.userId
    && subscription.authorizedUserId === candidate.customer.userId
  ) {
    return getAppUrl(`/mi/${candidate.business.slug}`)
  }
  return getBookingConfirmationUrl(candidate.business, candidate.id)
}

function classifyDelivery(
  subscription: Subscription,
  delivery: WebPushResult,
  occurredAt: Date,
): DeliveryDisposition {
  if (delivery.ok) return { kind: 'success', subscription, occurredAt }
  if (delivery.statusCode === 404 || delivery.statusCode === 410) {
    return { kind: 'gone', subscription, occurredAt }
  }
  if (
    delivery.statusCode === 400
    || delivery.statusCode === 401
    || delivery.statusCode === 403
  ) {
    return { kind: 'permanent', subscription, occurredAt }
  }
  return { kind: 'transient', subscription, occurredAt }
}

async function recordDisposition(disposition: DeliveryDisposition): Promise<boolean> {
  const { subscription } = disposition
  const deliveredGeneration = {
    id: subscription.id,
    subscriptionFingerprint: subscription.subscriptionFingerprint,
    revokedAt: null,
  }
  if (disposition.kind === 'success') {
    const updated = await prisma.pushSubscription.updateMany({
      where: deliveredGeneration,
      data: {
        failureCount: 0,
        lastFailureAt: null,
        lastSuccessAt: disposition.occurredAt,
      },
    })
    return updated.count === 1
  }

  if (disposition.kind === 'invalid') {
    const updated = await prisma.pushSubscription.updateMany({
      where: {
        ...deliveredGeneration,
        subscriptionEncrypted: subscription.subscriptionEncrypted,
      },
      data: {
        revokedAt: disposition.occurredAt,
        lastFailureAt: disposition.occurredAt,
        failureCount: { increment: 1 },
      },
    })
    return updated.count === 1
  }

  if (disposition.kind === 'gone') {
    const updated = await prisma.pushSubscription.updateMany({
      where: deliveredGeneration,
      data: {
        revokedAt: disposition.occurredAt,
        lastFailureAt: disposition.occurredAt,
        failureCount: { increment: 1 },
      },
    })
    return updated.count === 1
  }

  if (disposition.kind === 'permanent') {
    return prisma.$transaction(async (tx) => {
      const incremented = await tx.pushSubscription.updateMany({
        where: deliveredGeneration,
        data: {
          failureCount: { increment: 1 },
          lastFailureAt: disposition.occurredAt,
        },
      })
      if (incremented.count === 0) return false

      // This second statement observes the increment in the same transaction.
      // Concurrent workers serialize on the row, while a re-subscribe changes
      // the stable endpoint-and-keys fingerprint and makes both generation
      // guards no-ops.
      await tx.pushSubscription.updateMany({
        where: {
          ...deliveredGeneration,
          failureCount: { gte: 3 },
        },
        data: { revokedAt: disposition.occurredAt },
      })
      return true
    })
  }

  const updated = await prisma.pushSubscription.updateMany({
    where: deliveredGeneration,
    data: { lastFailureAt: disposition.occurredAt },
  })
  return updated.count === 1
}

export function cancellationWarningTtlSeconds(closesAt: Date, now: Date): number | null {
  const remainingSeconds = Math.floor((closesAt.getTime() - now.getTime()) / 1_000)
  if (!Number.isSafeInteger(remainingSeconds) || remainingSeconds <= 0) return null
  return Math.min(WARNING_LEAD_HOURS * 60 * 60, remainingSeconds)
}

async function deliverSubscription(
  candidate: Candidate,
  subscription: Subscription,
  body: string,
  closesAt: Date,
  readClock: Clock,
): Promise<DeliveryAttempt> {
  let normalized: ReturnType<typeof normalizePushSubscription>
  try {
    // The capability URL and browser keys stay encrypted until this worker
    // wins the booking lease. Losing concurrent workers never decrypt them.
    normalized = normalizePushSubscription(
      JSON.parse(decryptSecret(subscription.subscriptionEncrypted)) as unknown,
    )
  } catch {
    return { kind: 'invalid', subscription, occurredAt: readClock() }
  }

  // This clock read is deliberately adjacent to the external effect. A
  // cancellation or window close after it and before the provider accepts the
  // request is the unavoidable distributed-system boundary guarded by the
  // recoverable booking lease and a TTL no longer than the remaining window.
  const effectTime = readClock()
  const ttlSeconds = cancellationWarningTtlSeconds(closesAt, effectTime)
  if (ttlSeconds === null) return { kind: 'expired', subscription }

  try {
    const delivery = await sendWebPush(normalized, {
      title: candidate.business.name,
      body,
      url: pushDestination(candidate, subscription),
    }, ttlSeconds)
    return classifyDelivery(subscription, delivery, effectTime)
  } catch {
    return { kind: 'transient', subscription, occurredAt: effectTime }
  }
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
  readClock: Clock,
): Promise<'sent' | 'skipped' | 'error'> {
  const claimedAt = readClock()
  if (!isInsideWarningWindow(candidate, claimedAt)) return 'skipped'

  const staleBefore = new Date(claimedAt.getTime() - LEASE_MS)
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
      data: { cancellationReminderClaimedAt: claimedAt },
    })
    if (claim.count === 0) return 'skipped'
    claimOpen = true

    let revalidated = await revalidateClaimedCandidate(
      candidate.id,
      claimedAt,
      readClock(),
    )
    if (revalidated === null) {
      await releaseClaim(candidate.id, claimedAt)
      claimOpen = false
      return 'skipped'
    }

    let currentCandidate = {
      ...candidate,
      customer: { userId: revalidated.userId },
    }
    let subscriptions = await loadActiveSubscriptions(currentCandidate)
    if (subscriptions.length === 0) {
      await releaseClaim(candidate.id, claimedAt)
      claimOpen = false
      return 'skipped'
    }

    for (let deliveryRound = 0; deliveryRound < GENERATION_DELIVERY_ATTEMPTS; deliveryRound++) {
      const body = cancellationWarningText(revalidated.cutoffHours)
      if (!body) {
        await releaseClaim(candidate.id, claimedAt)
        claimOpen = false
        return 'skipped'
      }
      const { closesAt } = cancellationWarningWindow(
        revalidated.startDateTime,
        revalidated.cutoffHours,
      )
      const settledDeliveries = await mapSettledBounded(
        subscriptions,
        DELIVERY_CONCURRENCY,
        (subscription) => deliverSubscription(
          currentCandidate,
          subscription,
          body,
          closesAt,
          readClock,
        ),
      )
      const attempts: DeliveryAttempt[] = settledDeliveries.map((settled, index) => (
        settled.status === 'fulfilled'
          ? settled.value
          : { kind: 'transient', subscription: subscriptions[index], occurredAt: readClock() }
      ))
      const dispositions = attempts.filter(
        (attempt): attempt is DeliveryDisposition => attempt.kind !== 'expired',
      )
      const persisted = await mapSettledBounded(
        dispositions,
        DELIVERY_CONCURRENCY,
        (disposition) => recordDisposition(disposition),
      )
      const persistenceErrors = persisted.filter(({ status }) => status === 'rejected').length
      const recordedSuccesses = dispositions.reduce((count, disposition, index) => (
        disposition.kind === 'success'
        && persisted[index]?.status === 'fulfilled'
        && persisted[index].value
          ? count + 1
          : count
      ), 0)
      const staleSuccesses = dispositions.reduce((count, disposition, index) => (
        disposition.kind === 'success'
        && persisted[index]?.status === 'fulfilled'
        && !persisted[index].value
          ? count + 1
          : count
      ), 0)
      const counts = {
        success: recordedSuccesses,
        gone: dispositions.filter(({ kind }) => kind === 'gone').length,
        permanent: dispositions.filter(({ kind }) => kind === 'permanent').length,
        transient: dispositions.filter(({ kind }) => kind === 'transient').length,
        invalid: dispositions.filter(({ kind }) => kind === 'invalid').length,
        expired: attempts.filter(({ kind }) => kind === 'expired').length,
        stale: dispositions.filter((_, index) => (
          persisted[index]?.status === 'fulfilled' && !persisted[index].value
        )).length,
        persistenceErrors,
      }

      if (recordedSuccesses > 0) {
        const sentAt = readClock()
        const finalized = await prisma.booking.updateMany({
          where: {
            id: candidate.id,
            cancellationReminderClaimedAt: claimedAt,
            cancellationReminderSentAt: null,
          },
          data: {
            cancellationReminderSentAt: sentAt,
            cancellationReminderClaimedAt: null,
          },
        })
        if (finalized.count === 0) throw new Error('Cancellation warning claim was lost')
        claimOpen = false
        logger.info(
          'booking.cancellation_warning_sent',
          'Cancellation warning delivery completed',
          { bookingId: candidate.id, businessId: candidate.business.id, metadata: counts },
        )
        return 'sent'
      }

      if (
        staleSuccesses > 0
        && deliveryRound + 1 < GENERATION_DELIVERY_ATTEMPTS
      ) {
        revalidated = await revalidateClaimedCandidate(
          candidate.id,
          claimedAt,
          readClock(),
        )
        if (revalidated === null) {
          await releaseClaim(candidate.id, claimedAt)
          claimOpen = false
          return 'skipped'
        }
        currentCandidate = {
          ...candidate,
          customer: { userId: revalidated.userId },
        }
        subscriptions = await loadActiveSubscriptions(currentCandidate)
        if (subscriptions.length === 0) break
        continue
      }

      await releaseClaim(candidate.id, claimedAt)
      claimOpen = false
      if (dispositions.length === 0) return 'skipped'
      logger.error(
        'booking.cancellation_warning_failed',
        'Cancellation warning delivery failed',
        { bookingId: candidate.id, businessId: candidate.business.id, metadata: counts },
      )
      return 'error'
    }

    await releaseClaim(candidate.id, claimedAt)
    claimOpen = false
    return 'error'
  } catch (error) {
    if (claimOpen) {
      try {
        await releaseClaim(candidate.id, claimedAt)
      } catch {
        // Keep the original, sanitized failure path. The lease is recoverable.
      }
    }
    throw error
  }
}

export async function sendCancellationWarnings(
  nowOrClock: Date | Clock = () => new Date(),
): Promise<SendCancellationWarningsResult> {
  const result: SendCancellationWarningsResult = { sent: 0, skipped: 0, errors: 0 }
  if (!hasCompletePushConfig()) return result

  const readClock: Clock = typeof nowOrClock === 'function'
    ? nowOrClock
    : () => nowOrClock
  const scanTime = readClock()
  let cursor: string | undefined

  do {
    const candidates = await loadCandidateBatch(scanTime, cursor)
    for (const candidate of candidates) {
      try {
        const outcome = await processCandidate(candidate, readClock)
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
