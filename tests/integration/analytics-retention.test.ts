import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { prisma, seedAnalyticsReport } from '../helpers/analytics-report-db'
import { analyticsRetentionStatus, publishAnalyticsCohort, runOwnerAnalyticsMaintenance } from '@/server/analytics/maintenance'
const ids: string[] = []
afterEach(async () => { await prisma.business.deleteMany({ where: { id: { in: ids } } }); vi.restoreAllMocks() })
afterAll(async () => { await prisma.business.deleteMany({ where: { id: { in: ids } } }); await prisma.$disconnect() })
describe('bounded analytics retention independent of capture', () => {
  it('reserves snapshot cleanup and freezes before the first raw deletion, never deleting Booking', async () => {
    const f = await seedAnalyticsReport(); ids.push(f.businessId)
    await publishAnalyticsCohort(f.cohort)
    const now = new Date(+f.session.retentionExpiresAt + 1)
    const snapshotStart = performance.now()
    const result = await runOwnerAnalyticsMaintenance({ now, maxRows: 1 })
    const snapshotElapsedMs = performance.now() - snapshotStart
    expect(result.deleted).toBe(1)
    expect(result.hasMore).toBe(true)
    expect(await prisma.booking.findUnique({ where: { id: f.booking.id } })).toMatchObject({ analyticsAttemptId: null, analyticsVersion: null })
    const frozen = await prisma.analyticsDailyMetric.findMany({ where: { businessId: f.businessId } })
    expect(frozen.length).toBeGreaterThan(3)
    expect(frozen.every(r => r.frozenAt !== null)).toBe(true)
    if (process.env.OWNER_ANALYTICS_MEASURE_LOCAL === 'true') console.log(JSON.stringify({ metric: 'local-snapshot-freeze', snapshotsCleared: result.deleted, elapsedMs: snapshotElapsedMs, dailyCellsFrozen: frozen.length }))
    expect((await publishAnalyticsCohort({ ...f.cohort, now })).status).toBe('frozen')
    const drained = await runOwnerAnalyticsMaintenance({ now, cursor: result.nextCursor })
    expect(drained.errors).toBe(0)
    expect(await prisma.analyticsSession.count({ where: { businessId: f.businessId } })).toBe(0)
    expect(await prisma.booking.count({ where: { id: f.booking.id } })).toBe(1)
  })
  it('does not create zero history when sources expire without a successful publication', async () => {
    const f = await seedAnalyticsReport(); ids.push(f.businessId)
    await runOwnerAnalyticsMaintenance({ now: new Date(+f.session.retentionExpiresAt + 1), maxRows: 1 })
    const markers = await prisma.analyticsDailyMetric.findMany({ where: { businessId: f.businessId, metricKey: '__publication__' } })
    expect(markers).toHaveLength(3)
    expect(markers.every(r => r.state === 'failed' && r.frozenAt)).toBe(true)
  })
  it('counts every deleted child against 10000, pauses at 12h and drains idempotently beyond the limit', async () => {
    const f = await seedAnalyticsReport(); ids.push(f.businessId)
    const sessions = Array.from({ length: 60 }, () => ({ ...f.session, id: randomUUID(), bootstrapKey: randomUUID(), acceptedEventCount: 200 }))
    await prisma.analyticsSession.createMany({ data: sessions })
    for (const s of sessions) await prisma.bookingFunnelEvent.createMany({ data: Array.from({ length: 200 }, (_, i) => ({ businessId: f.businessId, sessionId: s.id, eventId: randomUUID(), version: 1, scope: 'session' as const, type: 'public_profile_viewed' as const, streamKey: `session:${s.id}`, sequence: i + 1, fingerprint: 'b'.repeat(64), data: {}, receivedAt: s.startedAt, retentionExpiresAt: s.retentionExpiresAt })) })
    await prisma.$executeRaw`ANALYZE "BookingFunnelEvent"`
    const plans = await prisma.$queryRaw`EXPLAIN (FORMAT JSON) SELECT id FROM "BookingFunnelEvent" WHERE "retentionExpiresAt" <= '2026-10-31' ORDER BY "retentionExpiresAt", id LIMIT 1000`
    expect(JSON.stringify(plans)).toContain('BookingFunnelEvent_retentionExpiresAt_id_idx')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const now = new Date(+f.session.retentionExpiresAt + 12 * 3600000)
    const count = async () => await prisma.bookingFunnelEvent.count({ where: { businessId: f.businessId } }) + await prisma.bookingFunnelAttempt.count({ where: { businessId: f.businessId } }) + await prisma.analyticsSession.count({ where: { businessId: f.businessId } }) + await prisma.booking.count({ where: { businessId: f.businessId, analyticsVersion: { not: null } } })
    const before = await count()
    const firstStart = performance.now()
    const first = await runOwnerAnalyticsMaintenance({ now, maxRows: 50000 })
    const firstElapsedMs = performance.now() - firstStart
    expect(first.deleted).toBe(10000)
    expect(before - await count()).toBe(10000)
    expect(first).toMatchObject({ hasMore: true, nextCursor: 'cleanup:v1', errors: 0 })
    expect(await prisma.analyticsCollectionPeriod.findFirst({ where: { businessId: f.businessId } })).toMatchObject({ closeReason: 'backlog', endedAt: now })
    expect(warn).toHaveBeenCalledWith('[owner-analytics] retention_backlog', { overdueHours: 12, beyondTolerance: false })
    const secondStart = performance.now()
    const second = await runOwnerAnalyticsMaintenance({ now, cursor: first.nextCursor })
    const secondElapsedMs = performance.now() - secondStart
    expect(second.errors).toBe(0)
    expect(await count()).toBe(0)
    expect((await runOwnerAnalyticsMaintenance({ now, cursor: first.nextCursor })).deleted).toBe(0)
    expect(await prisma.booking.count({ where: { id: f.booking.id } })).toBe(1)
    if (process.env.OWNER_ANALYTICS_MEASURE_LOCAL === 'true') {
      const dailyRows = await prisma.analyticsDailyMetric.count({ where: { businessId: f.businessId } })
      const dailyNow = new Date(+now + 2 * 86400000)
      const expiredWhere = { businessId: f.businessId, retentionExpiresAt: { lte: dailyNow } }
      const dailyEligible = await prisma.analyticsDailyMetric.count({ where: expiredWhere })
      const dailyStart = performance.now()
      const daily = await runOwnerAnalyticsMaintenance({ now: dailyNow })
      const dailyElapsedMs = performance.now() - dailyStart
      const dailyRowsAfter = await prisma.analyticsDailyMetric.count({ where: { businessId: f.businessId } })
      console.log(JSON.stringify({ metric: 'local-postgres-drain', before, sourceRows: { sessions: 61, attempts: 1, events: 12001, snapshots: 1 }, samples: [{ deleted: first.deleted, elapsedMs: firstElapsedMs }, { deleted: second.deleted, elapsedMs: secondElapsedMs }], dailyRows, dailyEligible, dailyDeleted: daily.deleted, dailyPublished: daily.published, dailyRowsAfter, dailyElapsedMs, bookingsPreserved: 1 }))
      expect(dailyEligible).toBeGreaterThan(0)
      expect(daily.deleted).toBe(dailyEligible)
      // A call can publish other still-retained period cohorts after deleting expired cells.
      expect(await prisma.analyticsDailyMetric.count({ where: expiredWhere })).toBe(0)
    }
  })
  it('coordinates publication and purge races, then expires daily history at its own 90d boundary', async () => {
    const f = await seedAnalyticsReport(); ids.push(f.businessId)
    await publishAnalyticsCohort(f.cohort)
    const now = new Date(+f.session.retentionExpiresAt + 1)
    await Promise.all([publishAnalyticsCohort({ ...f.cohort, now }), runOwnerAnalyticsMaintenance({ now })])
    const rows = await prisma.analyticsDailyMetric.findMany({ where: { businessId: f.businessId, cohortLocalDate: new Date('2026-08-01') } })
    expect(rows.filter(r => r.metricKey === '__publication__')).toHaveLength(3)
    expect(rows.every(r => r.frozenAt !== null && r.state === 'closed')).toBe(true)
    expect(rows.find(r => r.metricKey === 'conversion' && r.grain === 'total' && r.population === 'complete_attempts')).toMatchObject({ numerator: 1, denominator: 1 })
    await runOwnerAnalyticsMaintenance({ now: new Date('2026-10-31T00:00:00Z') })
    expect(await prisma.analyticsDailyMetric.count({ where: { businessId: f.businessId, cohortLocalDate: new Date('2026-08-01') } })).toBe(0)
  })
  it('tenant deletion cascades analytics and daily rows without orphaned snapshots', async () => {
    const f = await seedAnalyticsReport(); ids.push(f.businessId)
    await publishAnalyticsCohort(f.cohort)
    await prisma.business.delete({ where: { id: f.businessId } })
    expect(await prisma.analyticsSession.count({ where: { businessId: f.businessId } })).toBe(0)
    expect(await prisma.bookingFunnelAttempt.count({ where: { businessId: f.businessId } })).toBe(0)
    expect(await prisma.bookingFunnelEvent.count({ where: { businessId: f.businessId } })).toBe(0)
    expect(await prisma.analyticsDailyMetric.count({ where: { businessId: f.businessId } })).toBe(0)
    expect(await prisma.booking.count({ where: { businessId: f.businessId } })).toBe(0)
  })
  it('does not extend raw retention when malformed captured data prevents a rollup and reports the 24h tolerance', async () => {
    const f = await seedAnalyticsReport(); ids.push(f.businessId)
    await prisma.bookingFunnelEvent.update({ where: { id: f.event.id }, data: { data: { invalid: true } } })
    await expect(publishAnalyticsCohort(f.cohort)).rejects.toThrow()
    expect(await analyticsRetentionStatus(new Date(+f.session.retentionExpiresAt + 24 * 3600000))).toMatchObject({ dangerous: true, beyondTolerance: true })
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const result = await runOwnerAnalyticsMaintenance({ now: new Date(+f.session.retentionExpiresAt + 24 * 3600000) })
    expect(result.errors).toBe(0)
    expect(await prisma.bookingFunnelEvent.count({ where: { businessId: f.businessId } })).toBe(0)
    expect(await prisma.booking.findUnique({ where: { id: f.booking.id } })).toMatchObject({ analyticsVersion: null })
  })
  it('does not freeze an unrelated current-zone cohort when the snapshot still has its original attempt', async () => {
    const f = await seedAnalyticsReport(); ids.push(f.businessId)
    await publishAnalyticsCohort(f.cohort)
    await prisma.business.update({ where: { id: f.businessId }, data: { timezone: 'Pacific/Auckland' } })
    await runOwnerAnalyticsMaintenance({ now: new Date(+f.session.retentionExpiresAt + 1), maxRows: 1 })
    expect(await prisma.analyticsDailyMetric.count({ where: { businessId: f.businessId, businessTimeZone: 'Pacific/Auckland' } })).toBe(0)
  })
})
