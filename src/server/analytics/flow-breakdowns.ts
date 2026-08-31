import 'server-only'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { analyticsEventSchema, eventScope, type AcquisitionSource } from '@/lib/analytics/contracts'
import { reduceFunnelAttempt } from '@/lib/analytics/funnel'
import { aggregateFlowBreakdowns } from '@/lib/analytics/flow-breakdowns'
import type { AttemptProjection, FlowBreakdownsReport, ObservedEvent } from '@/lib/analytics/report-types'

interface FlowReadInput {
  businessId: string
  from: string
  to: string
  channel?: AcquisitionSource['channel']
  acquisitionLinkId?: string
  serviceId?: string
}
const SOURCE_LIMIT = 10000
const EVENT_LIMIT = 50000
const STREAM_LIMIT = 200
const PAGE_SIZE = 50

/** Internal DAL, called only after report authorization and tenant filter validation.
 * No Booking reads: this block describes retained observations, never conversion.
 * Its own snapshot/failure boundary cannot abort an already-calculated summary.
 */
export async function readOwnerAnalyticsFlowBreakdowns(input: FlowReadInput, now: Date): Promise<FlowBreakdownsReport> {
  const { businessId, from, to } = input
  const timezones = new Set<string>()
  const scope = input.channel ? 'channel' : input.acquisitionLinkId ? 'acquisition_link' : input.serviceId ? 'final_service' : 'all_attempts'
  function unavailable(status: 'not_retained' | 'incomplete_source' | 'limit_exceeded' | 'error'): FlowBreakdownsReport {
    return { status, from, to, cutoffAt: now.toISOString(), scope, timezones: [...timezones].sort(), groups: null }
  }
  try {
    return await prisma.$transaction(async tx => {
      const cohortLocalDate = { gte: new Date(from), lt: new Date(to) }
      const markers = await tx.analyticsDailyMetric.findMany({
        where: { businessId, cohortLocalDate, metricKey: '__publication__' },
        select: { businessTimeZone: true, definitionVersion: true, frozenAt: true, retentionExpiresAt: true },
        orderBy: { id: 'asc' }, take: SOURCE_LIMIT + 1,
      })
      if (markers.length > SOURCE_LIMIT) return unavailable('limit_exceeded')
      for (const m of markers) timezones.add(m.businessTimeZone)
      if (markers.some(m => m.frozenAt || m.retentionExpiresAt <= now)) return unavailable('not_retained')
      if (markers.some(m => m.definitionVersion !== 1)) return unavailable('incomplete_source')
      // One elapsed day on either side covers all supported UTC offsets and DST.
      // Calendar membership is still the source's immutable cohort date, not today's zone.
      const where = { businessId, cohortLocalDate, startedAt: { gte: new Date(+new Date(from) - 86400000), lt: new Date(+new Date(to) + 86400000), lte: now } }
      const sessions = await tx.analyticsSession.findMany({ where,
        select: { businessTimeZone: true, definitionVersion: true, retentionExpiresAt: true, normalizationVersion: true, consentVersion: true },
        orderBy: { id: 'asc' }, take: SOURCE_LIMIT + 1,
      })
      if (sessions.length > SOURCE_LIMIT) return unavailable('limit_exceeded')
      const attempts = await tx.bookingFunnelAttempt.findMany({ where,
        select: { id: true, businessId: true, sessionId: true, startedAt: true, conversionDeadlineAt: true, entryKind: true, definitionVersion: true, businessTimeZone: true, cohortLocalDate: true, channel: true, normalizationVersion: true, acquisitionLinkId: true, knownCaptureGap: true, acceptedEventCount: true, retentionExpiresAt: true },
        orderBy: { id: 'asc' }, take: SOURCE_LIMIT + 1,
      })
      if (sessions.length + attempts.length > SOURCE_LIMIT) return unavailable('limit_exceeded')
      for (const source of [...sessions, ...attempts]) timezones.add(source.businessTimeZone)
      if ([...sessions, ...attempts].some(s => s.retentionExpiresAt <= now)) return unavailable('not_retained')
      if ([...sessions, ...attempts].some(s => s.definitionVersion !== 1 || s.normalizationVersion !== 1) || sessions.some(s => s.consentVersion !== 1)) return unavailable('incomplete_source')
      const projections: AttemptProjection[] = []
      let eventCount = 0
      for (let offset = 0; offset < attempts.length; offset += PAGE_SIZE) {
        const page = attempts.slice(offset, offset + PAGE_SIZE)
        // Read whole attempt streams for accepted-count consistency, including later
        // receipts. The shared reducer alone applies the immutable report cutoff/deadline.
        const events = await tx.bookingFunnelEvent.findMany({
          where: { businessId, attemptId: { in: page.map(a => a.id) } },
          select: { attemptId: true, sessionId: true, scope: true, version: true, eventId: true, sequence: true, selectionRevision: true, type: true, data: true, receivedAt: true, retentionExpiresAt: true },
          orderBy: [{ attemptId: 'asc' }, { sequence: 'asc' }], take: PAGE_SIZE * STREAM_LIMIT + 1,
        })
        eventCount += events.length
        if (events.length > PAGE_SIZE * STREAM_LIMIT || eventCount > EVENT_LIMIT) return unavailable('limit_exceeded')
        if (events.some(e => e.retentionExpiresAt <= now)) return unavailable('not_retained')
        const byAttempt = new Map<string, typeof events>()
        for (const e of events) { const stream = byAttempt.get(e.attemptId!) ?? []; stream.push(e); byAttempt.set(e.attemptId!, stream) }
        for (const a of page) {
          const stored = byAttempt.get(a.id) ?? []
          if (stored.length > STREAM_LIMIT) return unavailable('limit_exceeded')
          if (a.acceptedEventCount !== stored.length) return unavailable('incomplete_source')
          const observed: ObservedEvent[] = []
          for (const e of stored) {
            const parsed = analyticsEventSchema.safeParse({ version: e.version, eventId: e.eventId, sequence: e.sequence, selectionRevision: e.selectionRevision, type: e.type, data: e.data })
            if (!parsed.success || e.scope !== 'attempt' || e.sessionId !== a.sessionId || eventScope(parsed.data.type) !== 'attempt') return unavailable('incomplete_source')
            observed.push({ event: parsed.data, receivedAt: e.receivedAt })
          }
          projections.push(reduceFunnelAttempt({
            attempt: { ...a, cohortLocalDate: a.cohortLocalDate.toISOString().slice(0, 10), acquisition: { channel: a.channel, acquisitionLinkId: a.acquisitionLinkId, normalizationVersion: 1 } },
            events: observed, bookings: [], now,
          }))
        }
      }
      // Validate EVERY source before applying the independent, immutable filters.
      const selected = projections.filter(p => (!input.channel || p.attempt.acquisition.channel === input.channel)
        && (!input.acquisitionLinkId || p.attempt.acquisition.acquisitionLinkId === input.acquisitionLinkId)
        && (!input.serviceId || p.finalContext?.serviceId === input.serviceId))
      return { status: selected.length ? 'available' : 'empty', from, to, cutoffAt: now.toISOString(), scope, timezones: [...timezones].sort(), groups: aggregateFlowBreakdowns(selected) }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 5000, timeout: 15000 })
  } catch {
    return unavailable('error')
  }
}
