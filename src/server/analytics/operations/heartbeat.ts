import 'server-only'
import { randomUUID } from 'node:crypto'
import { prisma } from '@/lib/db'

export const ANALYTICS_MAINTENANCE_JOB = 'owner_analytics_maintenance' as const
export const ANALYTICS_WEEKLY_INSIGHTS_JOB = 'weekly_insights' as const
const RUN_LEASE_MS = 11 * 60 * 1000

export type AnalyticsJobKey = typeof ANALYTICS_MAINTENANCE_JOB | typeof ANALYTICS_WEEKLY_INSIGHTS_JOB
export type HeartbeatResult = {
  errors: number
  deleted?: number
  published?: number
  hasMore?: boolean
  overdueMs?: number
  dangerous?: boolean
  beyondTolerance?: boolean
  durationMs?: number
  nextCursor?: string | null
}

export type AnalyticsJobRun = {
  jobKey: AnalyticsJobKey
  runId: string
  leaseToken: string
  batchSequence: number
  resumeCursor: string | null
}

function assertUuid(value: string, label: string): void {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error(`Invalid ${label}`)
  }
}

function boundedResult(result: HeartbeatResult): HeartbeatResult {
  return {
    errors: Math.max(0, Math.min(100000, Math.trunc(result.errors))),
    ...(result.deleted === undefined ? {} : { deleted: Math.max(0, Math.min(100000, Math.trunc(result.deleted))) }),
    ...(result.published === undefined ? {} : { published: Math.max(0, Math.min(100000, Math.trunc(result.published))) }),
    ...(result.hasMore === undefined ? {} : { hasMore: Boolean(result.hasMore) }),
    ...(result.overdueMs === undefined ? {} : { overdueMs: Math.max(0, Math.min(31 * 24 * 60 * 60 * 1000, Math.trunc(result.overdueMs))) }),
    ...(result.dangerous === undefined ? {} : { dangerous: Boolean(result.dangerous) }),
    ...(result.beyondTolerance === undefined ? {} : { beyondTolerance: Boolean(result.beyondTolerance) }),
    ...(result.durationMs === undefined ? {} : { durationMs: Math.max(0, Math.min(10 * 60 * 1000, Math.trunc(result.durationMs))) }),
    ...(result.nextCursor === undefined ? {} : { nextCursor: result.nextCursor?.slice(0, 1024) ?? null }),
  }
}

export async function startAnalyticsJobRun(jobKey: AnalyticsJobKey, now = new Date()): Promise<AnalyticsJobRun> {
  const runId = randomUUID()
  const leaseToken = randomUUID()
  const leaseExpiresAt = new Date(now.getTime() + RUN_LEASE_MS)
  const row = await prisma.$transaction(async (tx) => {
    const current = await tx.analyticsJobHeartbeat.findUnique({ where: { jobKey }, select: { lastStatus: true, leaseExpiresAt: true, lastResult: true } })
    if (current?.lastStatus === 'running' && current.leaseExpiresAt && current.leaseExpiresAt > now) {
      throw new Error('analytics_job_busy')
    }
    const resumeCursor = current?.lastStatus === 'running' || current?.lastStatus === 'partial' || current?.lastStatus === 'failed'
      ? (typeof current.lastResult === 'object' && current.lastResult !== null && !Array.isArray(current.lastResult) && typeof (current.lastResult as { nextCursor?: unknown }).nextCursor === 'string' ? (current.lastResult as { nextCursor: string }).nextCursor : null)
      : null
    const heartbeat = await tx.analyticsJobHeartbeat.upsert({
      where: { jobKey },
      create: {
        jobKey,
        currentRunId: runId,
        leaseToken,
        leaseExpiresAt,
        lastStartedAt: now,
        lastProgressAt: now,
        lastStatus: 'running',
        nextBatchSequence: 1,
        runErrors: 0,
      },
      update: {
        currentRunId: runId,
        leaseToken,
        leaseExpiresAt,
        lastStartedAt: now,
        lastProgressAt: now,
        lastStatus: 'running',
        nextBatchSequence: 1,
        runErrors: 0,
      },
      select: { nextBatchSequence: true },
    })
    return { ...heartbeat, resumeCursor }
  })
  return { jobKey, runId, leaseToken, batchSequence: row.nextBatchSequence ?? 1, resumeCursor: row.resumeCursor }
}

export async function recordAnalyticsJobProgress(input: {
  jobKey: AnalyticsJobKey
  runId: string
  leaseToken: string
  batchSequence: number
  hasMore: boolean
  errors: number
  nextCursor: string | null
  now?: Date
}): Promise<void> {
  assertUuid(input.runId, 'runId')
  assertUuid(input.leaseToken, 'leaseToken')
  if (!Number.isInteger(input.batchSequence) || input.batchSequence < 1) throw new Error('Invalid batch sequence')
  const now = input.now ?? new Date()
  const updated = await prisma.analyticsJobHeartbeat.updateMany({
    where: {
      jobKey: input.jobKey,
      currentRunId: input.runId,
      leaseToken: input.leaseToken,
      lastStatus: 'running',
      nextBatchSequence: input.batchSequence,
      leaseExpiresAt: { gt: now },
    },
    data: {
      lastProgressAt: now,
      nextBatchSequence: input.batchSequence + 1,
      runErrors: { increment: Math.max(0, Math.min(100000, Math.trunc(input.errors))) },
      lastResult: boundedResult({ errors: input.errors, hasMore: input.hasMore, nextCursor: input.nextCursor }),
    },
  })
  if (updated.count !== 1) throw new Error('analytics_job_stale_run')
}

export async function finishAnalyticsJobRun(input: {
  jobKey: AnalyticsJobKey
  runId: string
  leaseToken: string
  status: 'succeeded' | 'partial' | 'failed'
  result: HeartbeatResult
  now?: Date
}): Promise<boolean> {
  assertUuid(input.runId, 'runId')
  assertUuid(input.leaseToken, 'leaseToken')
  const now = input.now ?? new Date()
  const result = boundedResult(input.result)
  const successful = input.status === 'succeeded'
  const updated = await prisma.analyticsJobHeartbeat.updateMany({
    where: { jobKey: input.jobKey, currentRunId: input.runId, leaseToken: input.leaseToken, leaseExpiresAt: { gt: now } },
    data: {
      lastCompletedAt: now,
      lastStatus: input.status,
      leaseToken: null,
      leaseExpiresAt: null,
      lastResult: result,
      ...(successful ? {
        lastSuccessAt: now,
        consecutiveFailures: 0,
        consecutiveSuccesses: { increment: 1 },
      } : {
        consecutiveFailures: { increment: 1 },
        consecutiveSuccesses: 0,
      }),
    },
  })
  return updated.count === 1
}

export function isUuid(value: string | null | undefined): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}
