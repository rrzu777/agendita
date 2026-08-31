import 'server-only'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { ANALYTICS_POLICY as policy } from '@/lib/analytics/policy'
import { aggregateDailyMetrics } from '@/lib/analytics/daily-metrics'
import { getAnalyticsCaptureConfig } from '@/lib/analytics/budget'
import type { CohortCoverage } from '@/lib/analytics/report-types'
import { getLocalDateStr } from '@/lib/availability/timezone'
import { analyticsDayRange } from './reports'
import { analyticsCoverage, closeAnalyticsCollection, readAnalyticsCohort, withAnalyticsWrite } from './repository'
import { recordOperationalMetric } from '@/lib/metrics/operational'

export interface CohortPublicationInput { businessId: string; localDate: string; timezone: string; definitionVersion: number; now: Date }
export interface CohortPublicationResult { status: 'published' | 'not_mature' | 'stale' | 'frozen' | 'expired'; revision: number }
function cohortWhere(input: CohortPublicationInput) { return { businessId: input.businessId, cohortLocalDate: new Date(input.localDate), businessTimeZone: input.timezone, definitionVersion: input.definitionVersion } }

export async function publishAnalyticsCohort(input: CohortPublicationInput): Promise<CohortPublicationResult> {
  const day = analyticsDayRange(input.localDate, input.timezone)
  if (input.definitionVersion !== policy.definitionVersion || !Number.isFinite(+input.now)) throw new Error('Unsupported analytics publication')
  if (input.now < day.closeAfter) return { status: 'not_mature', revision: 0 }
  if (+day.end + policy.aggregateRetentionMs <= +input.now) return { status: 'expired', revision: 0 }
  return withAnalyticsWrite(input.businessId, async tx => {
    const where = cohortWhere(input)
    const previous = await tx.analyticsDailyMetric.findFirst({ where: { ...where, metricKey: '__publication__' } })
    if (previous?.frozenAt) return { status: 'frozen', revision: previous.revision }
    if (previous && previous.cutoffAt >= input.now) return { status: 'stale', revision: previous.revision }
    const coverage: CohortCoverage = { businessId: input.businessId, cohortLocalDate: input.localDate, businessTimeZone: input.timezone, definitionVersion: input.definitionVersion, cohortEndAt: day.end, calculatedAt: input.now, cutoffAt: input.now, revision: (previous?.revision ?? 0) + 1, state: 'closed', coverage: await analyticsCoverage(tx, input.businessId, input.timezone, input.definitionVersion, day.start, day.end, Boolean(getAnalyticsCaptureConfig(input.businessId))), frozenAt: null, retentionExpiresAt: new Date(+day.end + policy.aggregateRetentionMs) }
    const { cells } = await readAnalyticsCohort(tx, coverage, day.start)
    await tx.analyticsDailyMetric.deleteMany({ where })
    for (let offset = 0; offset < cells.length; offset += 1000) await tx.analyticsDailyMetric.createMany({ data: cells.slice(offset, offset + 1000).map(c => ({ ...c, cohortLocalDate: new Date(c.cohortLocalDate) })) })
    return { status: 'published', revision: coverage.revision }
  }, Prisma.TransactionIsolationLevel.RepeatableRead)
}

/** A failed frozen marker is a tombstone, not an observed zero. Same six-table schema. */
async function freezeCohort(tx: Prisma.TransactionClient, input: CohortPublicationInput) {
  const where = cohortWhere(input)
  const day = analyticsDayRange(input.localDate, input.timezone)
  if (+day.end + policy.aggregateRetentionMs <= +input.now) return
  const markers = await tx.analyticsDailyMetric.findMany({ where: { ...where, metricKey: '__publication__' }, take: 4 })
  if (markers.length === 3 && markers.every(m => m.state === 'closed' && m.revision === markers[0].revision)) {
    await tx.analyticsDailyMetric.updateMany({ where: { ...where, frozenAt: null }, data: { frozenAt: input.now } })
    return
  }
  const coverage: CohortCoverage = { businessId: input.businessId, cohortLocalDate: input.localDate, businessTimeZone: input.timezone, definitionVersion: input.definitionVersion, cohortEndAt: day.end, calculatedAt: input.now, cutoffAt: input.now, revision: Math.max(0, ...markers.map(m => m.revision)) + 1, state: 'failed', coverage: 'unknown', frozenAt: input.now, retentionExpiresAt: new Date(+day.end + policy.aggregateRetentionMs) }
  await tx.analyticsDailyMetric.deleteMany({ where })
  await tx.analyticsDailyMetric.createMany({ data: aggregateDailyMetrics({ sessions: [], attempts: [], coverage: [coverage], definitionVersion: input.definitionVersion }).map(c => ({ ...c, cohortLocalDate: new Date(c.cohortLocalDate) })) })
}

type CleanupKind = 'booking' | 'event' | 'attempt' | 'session' | 'daily'
const tables = { booking: 'Booking', event: 'BookingFunnelEvent', attempt: 'BookingFunnelAttempt', session: 'AnalyticsSession', daily: 'AnalyticsDailyMetric' } as const
const snapshotNulls = { analyticsVersion: null, analyticsSessionId: null, analyticsAttemptId: null, analyticsAttemptStartedAt: null, analyticsConversionDeadlineAt: null, analyticsRetentionExpiresAt: null, analyticsChannel: null, analyticsNormalizationVersion: null, analyticsAcquisitionLinkId: null, analyticsSelectionRevision: null }
type CleanupRow = { id: string; businessId: string; sessionId?: string; attemptId?: string | null; analyticsSessionId?: string | null; analyticsAttemptId?: string | null; analyticsAttemptStartedAt?: Date | null }

async function freezeSources(tx: Prisma.TransactionClient, businessId: string, kind: CleanupKind, rows: CleanupRow[], now: Date) {
  if (kind === 'daily') return
  const sessionIds = rows.map(r => kind === 'session' ? r.id : r.sessionId ?? r.analyticsSessionId).filter((v): v is string => Boolean(v))
  const attemptIds = rows.map(r => kind === 'attempt' ? r.id : r.attemptId ?? r.analyticsAttemptId).filter((v): v is string => Boolean(v))
  const sessions = await tx.analyticsSession.findMany({ where: { businessId, id: { in: sessionIds } }, select: { cohortLocalDate: true, businessTimeZone: true, definitionVersion: true }, take: 1000 })
  const attempts = await tx.bookingFunnelAttempt.findMany({ where: { businessId, id: { in: attemptIds } }, select: { id: true, cohortLocalDate: true, businessTimeZone: true, definitionVersion: true }, take: 1000 })
  // Scalar Booking snapshots can outlive their attempt. Freeze existing frozen-zone publications too.
  const knownAttempts = new Set(attempts.map(a => a.id))
  const snapshotStarts = rows.flatMap(r => r.analyticsAttemptStartedAt && (!r.analyticsAttemptId || !knownAttempts.has(r.analyticsAttemptId)) ? [r.analyticsAttemptStartedAt] : [])
  const existing = snapshotStarts.length ? await tx.analyticsDailyMetric.findMany({ where: { businessId, metricKey: '__publication__', population: 'complete_attempts', retentionExpiresAt: { gt: now } }, select: { cohortLocalDate: true, businessTimeZone: true, definitionVersion: true }, take: 1000 }) : []
  const fallback = snapshotStarts.length ? await tx.business.findUnique({ where: { id: businessId }, select: { timezone: true } }) : null
  const cohorts = [...sessions, ...attempts, ...existing.filter(c => snapshotStarts.some(s => getLocalDateStr(s, c.businessTimeZone) === c.cohortLocalDate.toISOString().slice(0, 10))), ...snapshotStarts.flatMap(s => fallback ? [{ cohortLocalDate: new Date(getLocalDateStr(s, fallback.timezone)), businessTimeZone: fallback.timezone, definitionVersion: 1 }] : [])]
  const unique = new Map(cohorts.map(c => [JSON.stringify([c.cohortLocalDate, c.businessTimeZone, c.definitionVersion]), c]))
  for (const c of unique.values()) await freezeCohort(tx, { businessId, localDate: c.cohortLocalDate.toISOString().slice(0, 10), timezone: c.businessTimeZone, definitionVersion: c.definitionVersion, now })
}

async function cleanupBatch(kind: CleanupKind, now: Date, limit: number): Promise<number> {
  const table = Prisma.raw(`"${tables[kind]}"`)
  const expiry = Prisma.raw(kind === 'booking' ? '"analyticsRetentionExpiresAt"' : '"retentionExpiresAt"')
  // Parents are eligible only after children are gone: the budget counts actual rows, never hidden CASCADE work.
  const noChildren = kind === 'attempt' ? Prisma.sql`AND NOT EXISTS (SELECT 1 FROM "BookingFunnelEvent" e WHERE e."businessId" = t."businessId" AND e."attemptId" = t.id)` : kind === 'session' ? Prisma.sql`AND NOT EXISTS (SELECT 1 FROM "BookingFunnelEvent" e WHERE e."businessId" = t."businessId" AND e."sessionId" = t.id) AND NOT EXISTS (SELECT 1 FROM "BookingFunnelAttempt" a WHERE a."businessId" = t."businessId" AND a."sessionId" = t.id)` : Prisma.empty
  const oldest = await prisma.$queryRaw<{ businessId: string }[]>(Prisma.sql`SELECT t."businessId" FROM ${table} t WHERE ${expiry} <= ${now} ${noChildren} ORDER BY ${expiry}, id LIMIT 1`)
  if (!oldest.length) return 0
  return withAnalyticsWrite(oldest[0].businessId, async tx => {
    const fields = kind === 'booking' ? Prisma.sql`t.id, t."businessId", t."analyticsSessionId", t."analyticsAttemptId", t."analyticsAttemptStartedAt"` : kind === 'event' ? Prisma.sql`t.id, t."businessId", t."sessionId", t."attemptId"` : kind === 'attempt' ? Prisma.sql`t.id, t."businessId", t."sessionId"` : Prisma.sql`t.id, t."businessId"`
    const rows = await tx.$queryRaw<CleanupRow[]>(Prisma.sql`SELECT ${fields} FROM ${table} t WHERE t."businessId" = ${oldest[0].businessId} AND ${expiry} <= ${now} ${noChildren} ORDER BY ${expiry}, id LIMIT ${limit} FOR UPDATE`)
    if (!rows.length) return 0
    await freezeSources(tx, oldest[0].businessId, kind, rows, now)
    const where = { businessId: oldest[0].businessId, id: { in: rows.map(r => r.id) } }
    if (kind === 'booking') return (await tx.booking.updateMany({ where, data: snapshotNulls })).count
    if (kind === 'event') return (await tx.bookingFunnelEvent.deleteMany({ where })).count
    if (kind === 'attempt') return (await tx.bookingFunnelAttempt.deleteMany({ where })).count
    if (kind === 'session') return (await tx.analyticsSession.deleteMany({ where })).count
    return (await tx.analyticsDailyMetric.deleteMany({ where })).count
  })
}

export async function analyticsRetentionStatus(now: Date) {
  const rows = await prisma.$queryRaw<{ oldest: Date | null }[]>`SELECT MIN(expiry) AS oldest FROM (
    (SELECT "retentionExpiresAt" AS expiry FROM "AnalyticsSession" ORDER BY "retentionExpiresAt", id LIMIT 1)
    UNION ALL (SELECT "retentionExpiresAt" FROM "BookingFunnelAttempt" ORDER BY "retentionExpiresAt", id LIMIT 1)
    UNION ALL (SELECT "retentionExpiresAt" FROM "BookingFunnelEvent" ORDER BY "retentionExpiresAt", id LIMIT 1)
    UNION ALL (SELECT "analyticsRetentionExpiresAt" FROM "Booking" WHERE "analyticsRetentionExpiresAt" IS NOT NULL ORDER BY "analyticsRetentionExpiresAt", id LIMIT 1)
    UNION ALL (SELECT "retentionExpiresAt" FROM "AnalyticsDailyMetric" ORDER BY "retentionExpiresAt", id LIMIT 1)
  ) e`
  const oldest = rows[0]?.oldest
  const overdueMs = oldest ? Math.max(0, +now - +oldest) : 0
  return { hasExpired: Boolean(oldest && oldest <= now), overdueMs, dangerous: overdueMs >= policy.backlogPauseMs, beyondTolerance: overdueMs >= 86400000 }
}

type PublicationCursor = { businessId: string; localDate: string; timezone: string; definitionVersion: number }
function decodeCursor(cursor?: string | null): PublicationCursor | null {
  if (!cursor || cursor === 'cleanup:v1') return null
  if (cursor.length > 1024) throw new Error('Invalid analytics maintenance cursor')
  try {
    const value = JSON.parse(Buffer.from(cursor, 'base64url').toString())
    if (Object.keys(value).sort().join() !== 'businessId,definitionVersion,localDate,timezone' || typeof value.businessId !== 'string' || value.businessId.length > 128 || value.definitionVersion !== 1) throw new Error()
    analyticsDayRange(value.localDate, value.timezone)
    return value
  } catch { throw new Error('Invalid analytics maintenance cursor') }
}

async function publicationCandidates(now: Date, after: PublicationCursor | null) {
  const lower = new Date(+now - policy.aggregateRetentionMs)
  const cursorFilter = after ? Prisma.sql`AND ("businessId", "localDate", timezone, "definitionVersion") > (${after.businessId}, ${after.localDate}, ${after.timezone}, ${after.definitionVersion})` : Prisma.empty
  return prisma.$queryRaw<PublicationCursor[]>(Prisma.sql`WITH candidates AS (
    SELECT "businessId", "cohortLocalDate"::text AS "localDate", "businessTimeZone" AS timezone, "definitionVersion" FROM "AnalyticsSession" WHERE "startedAt" >= ${lower}
    UNION SELECT "businessId", "cohortLocalDate"::text, "businessTimeZone", "definitionVersion" FROM "BookingFunnelAttempt" WHERE "startedAt" >= ${lower}
    UNION SELECT "businessId", "cohortLocalDate"::text, "businessTimeZone", "definitionVersion" FROM "AnalyticsDailyMetric" WHERE "retentionExpiresAt" > ${now} AND "frozenAt" IS NULL AND "metricKey" = '__publication__'
    UNION SELECT p."businessId", d.day::date::text, p."businessTimeZone", p."definitionVersion" FROM "AnalyticsCollectionPeriod" p CROSS JOIN LATERAL generate_series(GREATEST((p."startedAt" AT TIME ZONE 'UTC' AT TIME ZONE p."businessTimeZone")::date, (${lower} AT TIME ZONE p."businessTimeZone")::date), LEAST((COALESCE(p."endedAt", ${now}) AT TIME ZONE 'UTC' AT TIME ZONE p."businessTimeZone")::date, (${now} AT TIME ZONE p."businessTimeZone")::date), interval '1 day') d(day)
  ) SELECT * FROM candidates WHERE "definitionVersion" = 1 ${cursorFilter} ORDER BY "businessId", "localDate", timezone, "definitionVersion" LIMIT 11`)
}

export async function runOwnerAnalyticsMaintenance(input: { now?: Date; maxRows?: number; cursor?: string | null } = {}) {
  const deadline = performance.now() + 40000
  const now = input.now ?? new Date()
  if (!Number.isFinite(+now) || (input.maxRows !== undefined && (!Number.isInteger(input.maxRows) || input.maxRows < 1))) throw new Error('Invalid analytics maintenance budget')
  const maxRows = Math.min(input.maxRows ?? policy.cleanupInvocationRows, policy.cleanupInvocationRows)
  const after = decodeCursor(input.cursor)
  const result = { errors: 0, deleted: 0, published: 0, hasMore: false, nextCursor: null as string | null, backlog: await analyticsRetentionStatus(now) }
  if (result.backlog.dangerous || process.env.OWNER_ANALYTICS_ENABLED !== 'true') {
    // Bound transitions too. Public collector already fails closed globally at the 12h threshold.
    const periods = await prisma.analyticsCollectionPeriod.findMany({ where: { endedAt: null }, select: { businessId: true }, orderBy: { businessId: 'asc' }, take: 1000 })
    for (const p of periods) {
      if (performance.now() >= deadline) break
      await withAnalyticsWrite(p.businessId, tx => closeAnalyticsCollection(tx, p.businessId, now, result.backlog.dangerous ? 'backlog' : 'kill_switch'))
    }
    if (result.backlog.dangerous) { recordOperationalMetric('owner_analytics_retention_backlog', 'error', result.backlog.overdueMs); console.warn('[owner-analytics] retention_backlog', { overdueHours: Math.floor(result.backlog.overdueMs / 3600000), beyondTolerance: result.backlog.beyondTolerance }) }
  }
  async function drain(kind: CleanupKind, budget: number) {
    let used = 0
    while (used < budget && performance.now() < deadline) {
      try { const n = await cleanupBatch(kind, now, Math.min(1000, budget - used)); used += n; result.deleted += n; if (!n) break }
      catch { result.errors++; recordOperationalMetric('owner_analytics_cleanup', 'error', 0); break }
    }
  }
  // At least one batch is reserved for scalar snapshots even during an event flood.
  await drain('booking', Math.min(1000, maxRows))
  for (const kind of ['event', 'attempt', 'session', 'daily', 'booking'] as const) await drain(kind, maxRows - result.deleted)
  result.backlog = await analyticsRetentionStatus(now)
  if (result.backlog.hasExpired || performance.now() >= deadline) { result.hasMore = true; result.nextCursor = input.cursor ?? 'cleanup:v1'; return result }
  const candidates = await publicationCandidates(now, after)
  let last = after
  let processed = 0
  for (const c of candidates.slice(0, 10)) {
    if (performance.now() >= deadline) break
    try { if ((await publishAnalyticsCohort({ ...c, now })).status === 'published') result.published++ }
    catch { result.errors++; recordOperationalMetric('owner_analytics_publication', 'error', 0) }
    last = c; processed++
  }
  if (candidates.length > processed) { result.hasMore = true; result.nextCursor = last ? Buffer.from(JSON.stringify(last)).toString('base64url') : 'cleanup:v1' }
  return result
}
