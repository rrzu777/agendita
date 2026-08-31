import { afterAll, describe, expect, it } from 'vitest'
import { prisma, seedAnalyticsReport } from '../helpers/analytics-report-db'
import { publishAnalyticsCohort } from '@/server/analytics/maintenance'
import { randomUUID } from 'node:crypto'
const ids: string[] = []
afterAll(async () => { await prisma.business.deleteMany({ where: { id: { in: ids } } }); await prisma.$disconnect() })
describe('atomic analytics publications in PostgreSQL', () => {
  it('publishes mature cohorts with three markers and authoritative conversion', async () => {
    const f = await seedAnalyticsReport(); ids.push(f.businessId)
    expect((await publishAnalyticsCohort({ ...f.cohort, now: new Date('2026-08-02T23:59:59Z') })).status).toBe('not_mature')
    expect((await publishAnalyticsCohort(f.cohort)).status).toBe('published')
    const rows = await prisma.analyticsDailyMetric.findMany({ where: { businessId: f.businessId } })
    expect(rows.filter(r => r.metricKey === '__publication__')).toHaveLength(3)
    expect(rows.find(r => r.metricKey === 'conversion' && r.grain === 'total' && r.population === 'complete_attempts')).toMatchObject({ numerator: 1, denominator: 1, revision: 1 })
  })
  it('removes disappeared service keys after selective cleanup, rejects stale cutoff, and preserves failed previous revision', async () => {
    const f = await seedAnalyticsReport(); ids.push(f.businessId)
    await publishAnalyticsCohort(f.cohort)
    await prisma.bookingFunnelEvent.delete({ where: { id: f.event.id } })
    expect((await publishAnalyticsCohort({ ...f.cohort, now: new Date(+f.cohort.now + 1) })).status).toBe('published')
    expect(await prisma.analyticsDailyMetric.count({ where: { businessId: f.businessId, dimensionKey: 'historical-service' } })).toBe(0)
    expect((await publishAnalyticsCohort(f.cohort)).status).toBe('stale')
    const before = await prisma.analyticsDailyMetric.findMany({ where: { businessId: f.businessId }, orderBy: { id: 'asc' } })
    await prisma.bookingFunnelEvent.create({ data: { ...f.event, data: { arbitrary: 'invalid' } } })
    await expect(publishAnalyticsCohort({ ...f.cohort, now: new Date(+f.cohort.now + 2) })).rejects.toThrow()
    expect(await prisma.analyticsDailyMetric.findMany({ where: { businessId: f.businessId }, orderBy: { id: 'asc' } })).toEqual(before)
  })
  it('serializes competing revisions instead of mixing their cells', async () => {
    const f = await seedAnalyticsReport(); ids.push(f.businessId)
    await Promise.all([publishAnalyticsCohort(f.cohort), publishAnalyticsCohort({ ...f.cohort, now: new Date(+f.cohort.now + 1) })])
    const rows = await prisma.analyticsDailyMetric.findMany({ where: { businessId: f.businessId } })
    expect(rows.length).toBeGreaterThan(3)
    expect(new Set(rows.map(r => r.revision)).size).toBe(1)
    expect(rows.filter(r => r.metricKey === '__publication__')).toHaveLength(3)
  })
  it('rolls back replacement even when insertion fails AFTER deleting the previous revision', async () => {
    const f = await seedAnalyticsReport(); ids.push(f.businessId)
    await publishAnalyticsCohort(f.cohort)
    const before = await prisma.analyticsDailyMetric.findMany({ where: { businessId: f.businessId }, orderBy: { id: 'asc' } })
    // Task-owned disposable fault injector; no production schema or migration changes.
    const name = `analytics_failure_${randomUUID().replaceAll('-', '')}`
    await prisma.$executeRawUnsafe(`CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."businessId" = '${f.businessId}' THEN RAISE EXCEPTION 'synthetic publication failure'; END IF; RETURN NEW; END $$`)
    await prisma.$executeRawUnsafe(`CREATE TRIGGER ${name} BEFORE INSERT ON "AnalyticsDailyMetric" FOR EACH ROW EXECUTE FUNCTION ${name}()`)
    try {
      await expect(publishAnalyticsCohort({ ...f.cohort, now: new Date(+f.cohort.now + 1) })).rejects.toThrow()
      expect(await prisma.analyticsDailyMetric.findMany({ where: { businessId: f.businessId }, orderBy: { id: 'asc' } })).toEqual(before)
    } finally {
      await prisma.$executeRawUnsafe(`DROP TRIGGER ${name} ON "AnalyticsDailyMetric"`)
      await prisma.$executeRawUnsafe(`DROP FUNCTION ${name}()`)
    }
  })
  it('uses the tenant-attempt-createdAt Booking index on a representative synthetic history', async () => {
    const f = await seedAnalyticsReport(); ids.push(f.businessId)
    for (let page = 0; page < 3; page++) await prisma.booking.createMany({ data: Array.from({ length: 1000 }, () => ({ ...f.booking, id: randomUUID(), analyticsAttemptId: randomUUID() })) })
    await prisma.$executeRaw`ANALYZE "Booking"`
    const plans = await prisma.$queryRaw`EXPLAIN (FORMAT JSON) SELECT id FROM "Booking" WHERE "businessId" = ${f.businessId} AND "analyticsAttemptId" = ${f.attempt.id}::uuid AND "createdAt" >= ${f.attempt.startedAt} AND "createdAt" < ${f.attempt.conversionDeadlineAt}`
    expect(JSON.stringify(plans)).toContain('Booking_businessId_analyticsAttemptId_createdAt_idx')
  })
  it.each([
    ['2026-09-06', '2026-09-05', '2026-09-07', '2026-09-06T03:59:59.999Z', '2026-09-06T04:00:00Z', '2026-09-07T02:59:59.999Z', '2026-09-07T03:00:00Z', '2026-09-10'],
    ['2026-04-04', '2026-04-03', '2026-04-05', '2026-04-04T02:59:59.999Z', '2026-04-04T03:00:00Z', '2026-04-05T03:59:59.999Z', '2026-04-05T04:00:00Z', '2026-04-08'],
  ])('does not skip or duplicate PostgreSQL sessions around DST day %s', async (day, beforeDay, afterDay, before, first, last, after, now) => {
    const f = await seedAnalyticsReport(day, 'America/Santiago'); ids.push(f.businessId)
    for (const [instant, cohort] of [[before, beforeDay], [first, day], [last, day], [after, afterDay]]) {
      const startedAt = new Date(instant)
      await prisma.analyticsSession.create({ data: { ...f.session, id: randomUUID(), bootstrapKey: randomUUID(), startedAt, expiresAt: new Date(+startedAt + 86400000), retentionExpiresAt: new Date(+startedAt + 90 * 86400000), cohortLocalDate: new Date(cohort) } })
    }
    await prisma.analyticsCollectionPeriod.updateMany({ where: { businessId: f.businessId }, data: { startedAt: new Date(`${beforeDay}T00:00:00Z`) } })
    for (const localDate of [beforeDay, day, afterDay]) await publishAnalyticsCohort({ ...f.cohort, localDate, now: new Date(now) })
    const rows = await prisma.analyticsDailyMetric.findMany({ where: { businessId: f.businessId, metricKey: 'visits', grain: 'total' }, orderBy: { cohortLocalDate: 'asc' } })
    expect(rows.map(r => r.numerator)).toEqual([1, 3, 1])
  })
})
