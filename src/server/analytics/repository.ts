import 'server-only'
import { prisma } from '@/lib/db'
import type { Prisma, AnalyticsSession, BookingFunnelAttempt } from '@prisma/client'
import type { AnalyticsClaims } from '@/lib/analytics/credential'
import { analyticsEventSchema, selectionContextSchema, type AnalyticsEventInput } from '@/lib/analytics/contracts'
import { aggregateDailyMetrics } from '@/lib/analytics/daily-metrics'
import { reduceFunnelAttempt } from '@/lib/analytics/funnel'
import type { AttemptFact, CohortCoverage, DailyMetricCell, SessionFact } from '@/lib/analytics/report-types'

/** Analytics-only lock, never taken by Booking. Serializes tenant event IDs, stream caps and operator transitions. */
export async function withAnalyticsWrite<T>(businessId: string, work: (tx: Prisma.TransactionClient) => Promise<T>, isolationLevel?: Prisma.TransactionIsolationLevel): Promise<T> {
  for (let retry = 0; ; retry++) {
    try {
      return await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`owner-analytics:${businessId}`}, 0))`
        return work(tx)
      }, { maxWait: 5000, timeout: 15000, isolationLevel })
    } catch (error) {
      if (retry === 0 && error && typeof error === 'object' && 'code' in error && ['P2002', 'P2034'].includes(String(error.code))) continue
      throw error
    }
  }
}

export async function collectionIsOpen(tx: Prisma.TransactionClient, businessId: string) {
  return Boolean(await tx.analyticsCollectionPeriod.findFirst({ where: { businessId, endedAt: null, consentVersion: 1, definitionVersion: 1, business: { isActive: true } }, select: { id: true } }))
}

export async function closeAnalyticsCollection(tx: Prisma.TransactionClient, businessId: string, now: Date, closeReason: 'budget' | 'operator' | 'backlog' | 'kill_switch') {
  return tx.analyticsCollectionPeriod.updateMany({ where: { businessId, endedAt: null }, data: { endedAt: now, closeReason } })
}

export interface AvailabilityDiagnostics { eligible: number; affected: number; converted: number; reasons: Record<string, number> }
export interface CohortRead { cells: DailyMetricCell[]; inProgress: { complete: number; partial: number }; diagnostics: AvailabilityDiagnostics }

/** Server-only bounded pages. Reduce events and Booking separately BEFORE aggregation; never a fan-out join. */
export async function readAnalyticsCohort(tx: Prisma.TransactionClient, coverage: CohortCoverage, start: Date): Promise<CohortRead> {
  const identity = { businessId: coverage.businessId, businessTimeZone: coverage.businessTimeZone, definitionVersion: coverage.definitionVersion, cohortLocalDate: new Date(coverage.cohortLocalDate) }
  const window = { gte: start, lt: new Date(Math.min(+coverage.cohortEndAt, +coverage.cutoffAt + 1)) }
  const cells = new Map<string, DailyMetricCell>()
  const result: CohortRead = { cells: [], inProgress: { complete: 0, partial: 0 }, diagnostics: { eligible: 0, affected: 0, converted: 0, reasons: {} } }
  let sources = 0
  function merge(page: DailyMetricCell[]) {
    for (const c of page) {
      const key = JSON.stringify([c.population, c.grain, c.dimensionKey, c.metricKey])
      const previous = cells.get(key)
      if (previous) { previous.numerator += c.numerator; previous.denominator += c.denominator }
      else cells.set(key, c)
    }
    if (cells.size > 20000 || [...cells.values()].some(c => c.numerator > 2147483647 || c.denominator > 2147483647)) throw new Error('Analytics projection limit exceeded')
  }
  merge(aggregateDailyMetrics({ sessions: [], attempts: [], coverage: [coverage], definitionVersion: coverage.definitionVersion }))
  let after: string | undefined
  for (;;) {
    const page = await tx.analyticsSession.findMany({ where: { ...identity, startedAt: window, ...(after ? { id: { gt: after } } : {}) }, orderBy: { id: 'asc' }, take: 50 })
    if (!page.length) break
    sources += page.length
    if (sources > 10000) throw new Error('Analytics source limit exceeded')
    const sessions: SessionFact[] = []
    for (const s of page) {
      // Only existence matters for visit→attempt, not the number of child attempts.
      const child = await tx.bookingFunnelAttempt.findFirst({ where: { businessId: s.businessId, sessionId: s.id, startedAt: { gte: s.startedAt, lt: s.expiresAt } }, select: { startedAt: true }, orderBy: { startedAt: 'asc' } })
      sessions.push({ ...s, cohortLocalDate: s.cohortLocalDate.toISOString().slice(0, 10), acquisition: { channel: s.channel, normalizationVersion: 1, acquisitionLinkId: s.acquisitionLinkId }, attemptStartedAts: child ? [child.startedAt] : [] })
    }
    merge(aggregateDailyMetrics({ sessions, attempts: [], coverage: [coverage], definitionVersion: coverage.definitionVersion }))
    after = page.at(-1)!.id
  }
  after = undefined
  for (;;) {
    const page: BookingFunnelAttempt[] = await tx.bookingFunnelAttempt.findMany({ where: { ...identity, startedAt: window, ...(after ? { id: { gt: after } } : {}) }, orderBy: { id: 'asc' }, take: 50 })
    if (!page.length) break
    sources += page.length
    if (sources > 10000) throw new Error('Analytics source limit exceeded')
    for (const a of page) {
      const stored = await tx.bookingFunnelEvent.findMany({ where: { businessId: a.businessId, sessionId: a.sessionId, attemptId: a.id }, orderBy: { sequence: 'asc' }, take: 201 })
      const bookings = await tx.booking.findMany({ where: { businessId: a.businessId, analyticsAttemptId: a.id, createdAt: { gte: a.startedAt, lt: a.conversionDeadlineAt } }, select: { id: true, businessId: true, analyticsAttemptId: true, createdAt: true, serviceId: true, modality: true, analyticsSelectionRevision: true }, take: 1001 })
      if (stored.length > 200 || bookings.length > 1000) throw new Error('Analytics stream limit exceeded')
      const attempt: AttemptFact = { ...a, knownCaptureGap: a.knownCaptureGap || a.acceptedEventCount !== stored.length, cohortLocalDate: a.cohortLocalDate.toISOString().slice(0, 10), acquisition: { channel: a.channel, normalizationVersion: 1, acquisitionLinkId: a.acquisitionLinkId } }
      const events = stored.map(e => ({ receivedAt: e.receivedAt, event: analyticsEventSchema.parse({ version: e.version, eventId: e.eventId, sequence: e.sequence, selectionRevision: e.selectionRevision, type: e.type, data: e.data }) }))
      const p = reduceFunnelAttempt({ attempt, events, bookings, now: coverage.cutoffAt })
      if (!p.mature) result.inProgress[a.entryKind]++
      if (p.mature && a.entryKind === 'complete' && p.availability.hasValidResult) {
        result.diagnostics.eligible++
        if (p.availability.hasEmpty) {
          result.diagnostics.affected++
          if (p.converted) result.diagnostics.converted++
          for (const reason of p.availability.emptyReasons) result.diagnostics.reasons[reason] = (result.diagnostics.reasons[reason] ?? 0) + 1
        }
      }
      merge(aggregateDailyMetrics({ sessions: [], attempts: [p], coverage: [coverage], definitionVersion: coverage.definitionVersion }))
    }
    after = page.at(-1)!.id
  }
  result.cells = [...cells.values()]
  return result
}

export async function analyticsCoverage(tx: Prisma.TransactionClient, businessId: string, timezone: string, version: number, start: Date, end: Date, captureConfigured: boolean) {
  const periods = await tx.analyticsCollectionPeriod.findMany({ where: { businessId, startedAt: { lt: end }, OR: [{ endedAt: null }, { endedAt: { gt: start } }] }, orderBy: { startedAt: 'asc' }, take: 1001 })
  if (periods.length > 1000) return 'unknown' as const
  if (!periods.length) return 'disabled' as const
  if (periods.some(p => p.businessTimeZone !== timezone || p.definitionVersion !== version || (!p.endedAt && !captureConfigured) || p.closeReason === 'kill_switch')) return 'unknown' as const
  let coveredUntil = +start
  for (const p of periods) {
    if (+p.startedAt > coveredUntil) return 'partial' as const
    coveredUntil = Math.max(coveredUntil, p.endedAt ? +p.endedAt : +end)
  }
  return coveredUntil >= +end ? 'complete' as const : 'partial' as const
}

export function claimsForSession(session: AnalyticsSession): Extract<AnalyticsClaims, { scope: 'session' }> {
  return {
    version: 1, scope: 'session', businessId: session.businessId, sessionId: session.id, origin: session.origin,
    consentVersion: 1, definitionVersion: 1, sessionStartedAt: session.startedAt.toISOString(), sessionExpiresAt: session.expiresAt.toISOString(), retentionExpiresAt: session.retentionExpiresAt.toISOString(),
    acquisition: { channel: session.channel, normalizationVersion: 1, acquisitionLinkId: session.acquisitionLinkId },
  }
}
export function claimsForAttempt(session: AnalyticsSession, attempt: BookingFunnelAttempt): Extract<AnalyticsClaims, { scope: 'attempt' }> {
  return { ...claimsForSession(session), scope: 'attempt', attemptId: attempt.id, attemptStartedAt: attempt.startedAt.toISOString(), conversionDeadlineAt: attempt.conversionDeadlineAt.toISOString() }
}

export function eventDimensions(event: AnalyticsEventInput) {
  const data = event.data
  const parsed = selectionContextSchema.safeParse('context' in data ? data.context : 'modality' in data ? { serviceId: data.serviceId, modality: data.modality, professional: data.professional } : null)
  const context = parsed.success ? parsed.data : null
  return {
    serviceId: context?.serviceId ?? ('serviceId' in data ? data.serviceId : null),
    modality: context?.modality ?? null,
    professionalId: context?.professional.kind === 'person' ? context.professional.professionalId : null,
    promotionId: 'promotionId' in data ? data.promotionId : null,
  }
}

export async function eventDimensionsBelong(tx: Prisma.TransactionClient, businessId: string, event: AnalyticsEventInput): Promise<boolean> {
  const dims = eventDimensions(event)
  if (dims.serviceId && !await tx.service.findFirst({ where: { businessId, id: dims.serviceId }, select: { id: true } })) return false
  if (dims.professionalId && !await tx.professional.findFirst({ where: { businessId, id: dims.professionalId }, select: { id: true } })) return false
  if (dims.promotionId && !await tx.promotion.findFirst({ where: { businessId, id: dims.promotionId }, select: { id: true } })) return false
  return true
}
