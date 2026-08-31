import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { prisma, seedAnalyticsReport } from '../helpers/analytics-report-db'
import { getOwnerAnalyticsReport } from '@/server/analytics/reports'
import { publishAnalyticsCohort } from '@/server/analytics/maintenance'
const auth = vi.hoisted(() => vi.fn())
vi.mock('@/lib/auth/user', () => ({ getCurrentUserWithBusiness: auth }))
const ids: string[] = []
beforeEach(() => vi.stubEnv('OWNER_ANALYTICS_ENABLED', 'false'))
afterEach(() => vi.unstubAllEnvs())
afterAll(async () => { await prisma.business.deleteMany({ where: { id: { in: ids } } }); await prisma.$disconnect() })
async function ownerFixture() {
  const f = await seedAnalyticsReport(); ids.push(f.businessId)
  auth.mockResolvedValue({ user: { id: 'synthetic' }, role: 'owner', business: { id: f.businessId, timezone: 'UTC', slug: f.businessId } })
  return f
}
const period = { from: '2026-08-01', to: '2026-08-02' }
describe('report authorization, current evidence and isolated DTO', () => {
  it.each([false, true])('does not claim retained raw diagnostics were purged for a closed report (channel filter: %s)', async channel => {
    const f = await ownerFixture()
    await publishAnalyticsCohort(f.cohort)
    await prisma.analyticsDailyMetric.updateMany({ where: { businessId: f.businessId, population: 'complete_attempts', metricKey: 'availability_empty' }, data: { numerator: 6, denominator: 20 } })
    expect(await prisma.bookingFunnelEvent.count({ where: { businessId: f.businessId, retentionExpiresAt: { gt: f.cohort.now } } })).toBe(1)
    const report = await getOwnerAnalyticsReport({ ...period, ...(channel ? { channel: 'instagram' } : {}) }, f.cohort.now)
    expect(report.opportunities[0]?.diagnostics.status).toBe('not_queried')
  })
  it('authorizes DAL independently and rejects caller tenant, foreign filters and impossible intersections', async () => {
    await ownerFixture()
    await expect(getOwnerAnalyticsReport({ ...period, businessId: 'foreign' })).rejects.toThrow()
    await expect(getOwnerAnalyticsReport({ ...period, acquisitionLinkId: 'foreign' })).rejects.toThrow()
    await expect(getOwnerAnalyticsReport({ ...period, serviceId: 'x', channel: 'instagram' })).rejects.toThrow()
    auth.mockResolvedValue({ user: { id: 'staff' }, role: 'staff', business: { id: ids[0] } })
    await expect(getOwnerAnalyticsReport(period)).rejects.toThrow()
    auth.mockResolvedValue(null)
    await expect(getOwnerAnalyticsReport(period)).rejects.toThrow()
  })
  it('retains historical truth with capture off and exposes no raw identities, tokens or configuration', async () => {
    const f = await ownerFixture()
    await publishAnalyticsCohort(f.cohort)
    const other = await seedAnalyticsReport(); ids.push(other.businessId)
    await publishAnalyticsCohort(other.cohort)
    const report = await getOwnerAnalyticsReport(period, f.cohort.now)
    expect(report).toMatchObject({ capture: { enabled: false }, complete: { conversion: { numerator: 1, denominator: 1, rate: 1 } }, comparison: { status: 'coverage_not_comparable', deltaPercentagePoints: null } })
    const json = JSON.stringify(report)
    for (const forbidden of [f.attempt.id, f.session.id, f.booking.id, other.businessId, 'restToken', 'secret', 'customerId']) expect(json).not.toContain(forbidden)
  })
  it('shows first-day visits and attempts in a provisional block without mature denominators', async () => {
    const f = await ownerFixture()
    const report = await getOwnerAnalyticsReport(period, new Date('2026-08-01T15:00:00Z'))
    expect(report).toMatchObject({ recent: { status: 'provisional', visits: 1, complete: { attempts: 1, conversion: { numerator: 0, denominator: 0, rate: null } }, inProgress: { complete: 1, partial: 0 } } })
    expect(await prisma.analyticsDailyMetric.count({ where: { businessId: f.businessId } })).toBe(0)
  })
  it('caps service rows at the requested page size, not twice that size for two populations', async () => {
    const f = await ownerFixture()
    await publishAnalyticsCohort(f.cohort)
    const report = await getOwnerAnalyticsReport({ ...period, pageSize: 1 }, f.cohort.now)
    expect(report.services.rows).toHaveLength(1)
    expect(report.services.total).toBeGreaterThan(1)
  })
  it('uses only expired pending_confirmation requests for the operational queue regardless of payment status', async () => {
    const f = await ownerFixture()
    const now = f.cohort.now
    const data = f.booking
    await prisma.booking.createMany({ data: [
      { ...data, id: 'approval-paid-' + f.businessId, status: 'pending_confirmation', paymentStatus: 'fully_paid', approvalExpiresAt: new Date(+now - 1) },
      { ...data, id: 'approval-equal-' + f.businessId, status: 'pending_confirmation', approvalExpiresAt: now, startDateTime: new Date(+data.startDateTime + 86400000), endDateTime: new Date(+data.endDateTime + 86400000) },
      { ...data, id: 'hold-' + f.businessId, status: 'pending_payment', holdExpiresAt: new Date(+now - 1), startDateTime: new Date(+data.startDateTime + 2 * 86400000), endDateTime: new Date(+data.endDateTime + 2 * 86400000) },
    ] })
    expect(await getOwnerAnalyticsReport(period, now)).toMatchObject({ currentBookings: { overdueApproval: { count: 1, lowerBound: false } }, opportunities: [{ key: 'overdue_approval', numerator: 1 }] })
  })
  it('keeps recent cohorts in their frozen timezone after the business changes zone', async () => {
    const f = await ownerFixture()
    await prisma.business.update({ where: { id: f.businessId }, data: { timezone: 'America/Santiago' } })
    auth.mockResolvedValue({ user: { id: 'synthetic' }, role: 'owner', business: { id: f.businessId, timezone: 'America/Santiago' } })
    expect(await getOwnerAnalyticsReport(period, new Date('2026-08-01T15:00:00Z'))).toMatchObject({ recent: { visits: 1, complete: { attempts: 1 }, timezones: expect.arrayContaining(['UTC']) } })
  })
  it.each([
    ['UTC', 'America/Santiago', '2026-08-02', '2026-08-02T00:30:00Z', '2026-08-02T02:00:00Z'],
    ['America/Santiago', 'UTC', '2026-08-01', '2026-08-02T02:30:00Z', '2026-08-02T03:00:00Z'],
  ])('discovers recent %s cohorts after switching to %s across a local-date boundary', async (timezone, currentZone, day, start, cutoff) => {
    const f = await seedAnalyticsReport(day, timezone); ids.push(f.businessId)
    const startedAt = new Date(start), now = new Date(cutoff)
    const expiresAt = new Date(+startedAt + 86400000), retentionExpiresAt = new Date(+startedAt + 90 * 86400000)
    await prisma.analyticsSession.update({ where: { id: f.session.id }, data: { startedAt, expiresAt, retentionExpiresAt } })
    await prisma.bookingFunnelAttempt.update({ where: { id: f.attempt.id }, data: { startedAt, conversionDeadlineAt: expiresAt, retentionExpiresAt } })
    await prisma.bookingFunnelEvent.update({ where: { id: f.event.id }, data: { receivedAt: startedAt, retentionExpiresAt } })
    await prisma.business.update({ where: { id: f.businessId }, data: { timezone: currentZone } })
    auth.mockResolvedValue({ user: { id: 'synthetic' }, role: 'owner', business: { id: f.businessId, timezone: currentZone } })
    // A later server-stamped source in the same frozen day must remain outside this cutoff.
    const future = new Date(+now + 60000)
    const futureSession = await prisma.analyticsSession.create({ data: { ...f.session, id: crypto.randomUUID(), bootstrapKey: crypto.randomUUID(), startedAt: future, expiresAt: new Date(+future + 86400000), retentionExpiresAt: new Date(+future + 90 * 86400000) } })
    await prisma.bookingFunnelAttempt.create({ data: { ...f.attempt, id: crypto.randomUUID(), bootstrapKey: crypto.randomUUID(), sessionId: futureSession.id, startedAt: future, conversionDeadlineAt: futureSession.expiresAt, retentionExpiresAt: futureSession.retentionExpiresAt } })
    const report = await getOwnerAnalyticsReport({}, now)
    expect(report.recent).toMatchObject({ visits: 1, complete: { attempts: 1, conversion: { numerator: 0, denominator: 0, rate: null } }, inProgress: { complete: 1, partial: 0 }, cutoffAt: now.toISOString(), timezones: expect.arrayContaining([timezone]) })
    // Explicit historical bounds remain exclusive calendar dates, not a request for current activity.
    const to = day, from = new Date(+new Date(day) - 86400000).toISOString().slice(0, 10)
    expect((await getOwnerAnalyticsReport({ from, to }, now)).recent).toMatchObject({ visits: 0, complete: { attempts: 0 }, inProgress: { complete: 0, partial: 0 } })
  })
  it.each(['channel', 'link'] as const)('does not include organic open attempts in a %s-filtered recent population', async kind => {
    const f = await ownerFixture()
    const link = await prisma.acquisitionLink.create({ data: { businessId: f.businessId, token: crypto.randomUUID(), channel: 'instagram', campaignName: 'Filtered fixture' } })
    await prisma.analyticsSession.update({ where: { id: f.session.id }, data: { channel: 'direct' } })
    await prisma.bookingFunnelAttempt.update({ where: { id: f.attempt.id }, data: { channel: 'direct' } })
    await prisma.bookingFunnelAttempt.create({ data: { ...f.attempt, id: crypto.randomUUID(), bootstrapKey: crypto.randomUUID(), entryKind: 'partial', channel: 'direct' } })
    const filter = kind === 'channel' ? { channel: 'instagram' } : { acquisitionLinkId: link.id }
    expect((await getOwnerAnalyticsReport({ ...period, ...filter }, new Date('2026-08-01T15:00:00Z'))).recent).toMatchObject({ complete: { attempts: 0, conversion: { denominator: 0 } }, partial: { attempts: 0, conversion: { denominator: 0 } }, inProgress: { complete: 0, partial: 0 } })
  })
  it.each(['channel', 'link'] as const)('separates mature and open complete/partial attempts in the same %s-filtered population', async kind => {
    const f = await ownerFixture()
    const link = await prisma.acquisitionLink.create({ data: { businessId: f.businessId, token: crypto.randomUUID(), channel: 'instagram', campaignName: 'Mixed fixture' } })
    await prisma.analyticsSession.update({ where: { id: f.session.id }, data: { acquisitionLinkId: link.id } })
    await prisma.bookingFunnelAttempt.update({ where: { id: f.attempt.id }, data: { acquisitionLinkId: link.id } })
    const organic = await prisma.analyticsSession.create({ data: { ...f.session, id: crypto.randomUUID(), bootstrapKey: crypto.randomUUID(), channel: 'direct' } })
    for (const entryKind of ['complete', 'partial'] as const) for (const matched of [true, false]) await prisma.bookingFunnelAttempt.create({ data: { ...f.attempt, id: crypto.randomUUID(), bootstrapKey: crypto.randomUUID(), sessionId: matched ? f.session.id : organic.id, entryKind, channel: matched ? 'instagram' : 'direct', acquisitionLinkId: matched ? link.id : null, startedAt: new Date('2026-08-01T14:00:00Z'), conversionDeadlineAt: new Date('2026-08-02T14:00:00Z') } })
    const filter = kind === 'channel' ? { channel: 'instagram' } : { acquisitionLinkId: link.id }
    const report = await getOwnerAnalyticsReport({ ...period, ...filter }, new Date('2026-08-02T13:00:00Z'))
    expect(report.recent).toMatchObject({ complete: { attempts: 2, conversion: { numerator: 1, denominator: 1, rate: 1 } }, partial: { attempts: 1, conversion: { numerator: 0, denominator: 0, rate: null } }, inProgress: { complete: 1, partial: 1 } })
  })
  it('lists manageable tenant links before they have any historical traffic', async () => {
    const f = await ownerFixture()
    const link = await prisma.acquisitionLink.create({ data: { businessId: f.businessId, token: 'synthetic-public-link-token', channel: 'instagram', campaignName: 'Synthetic launch' } })
    expect(await getOwnerAnalyticsReport(period, f.cohort.now)).toMatchObject({ acquisitionLinks: { total: 1, rows: [{ id: link.id, campaignName: 'Synthetic launch', url: expect.stringContaining('acq=synthetic-public-link-token') }] } })
  })
  it('resolves current attended counts for the same service-pair page shown by the historical table', async () => {
    const f = await ownerFixture()
    const partial = await prisma.bookingFunnelAttempt.create({ data: { ...f.attempt, id: crypto.randomUUID(), bootstrapKey: crypto.randomUUID(), entryKind: 'partial' } })
    await prisma.booking.create({ data: { ...f.booking, id: crypto.randomUUID(), status: 'completed', analyticsAttemptId: partial.id } })
    await publishAnalyticsCohort(f.cohort)
    const report = await getOwnerAnalyticsReport({ ...period, pageSize: 1, page: 2 }, f.cohort.now)
    expect(report.services.rows).toMatchObject([{ id: f.service.id, population: 'partial_attempts' }])
    expect(report.currentBookings.attendedByService).toEqual([{ serviceId: f.service.id, count: 1 }])
  })
  it('suppresses 28-day vs 2-day comparisons even when both populations contain mature conversions', async () => {
    const f = await ownerFixture()
    const now = new Date('2026-08-31T12:00:00Z')
    const dates = Array.from({ length: 56 }, (_, i) => new Date(+new Date('2026-07-04') + i * 86400000))
    await prisma.analyticsDailyMetric.createMany({ data: dates.flatMap((cohortLocalDate, i) => {
      const enabled = i >= 28 || i < 2
      const base = { businessId: f.businessId, cohortLocalDate, businessTimeZone: 'UTC', definitionVersion: 1, grain: 'total' as const, dimensionKey: 'total', numerator: 0, denominator: 0, revision: 1, state: 'closed' as const, coverage: enabled ? 'complete' as const : 'disabled' as const, calculatedAt: now, cutoffAt: now, retentionExpiresAt: new Date(+cohortLocalDate + 91 * 86400000) }
      return [...(['sessions', 'complete_attempts', 'partial_attempts'] as const).map(population => ({ ...base, population, metricKey: '__publication__' })), ...(enabled ? [{ ...base, population: 'complete_attempts' as const, metricKey: 'conversion', numerator: 1, denominator: 2 }] : [])]
    }) })
    const input = { from: '2026-08-01', to: '2026-08-29' }
    expect(await getOwnerAnalyticsReport(input, now)).toMatchObject({ complete: { conversion: { numerator: 28, denominator: 56 } }, comparison: { status: 'coverage_not_comparable', previousConversion: { numerator: 2, denominator: 4 }, deltaPercentagePoints: null } })
    await prisma.analyticsDailyMetric.updateMany({ where: { businessId: f.businessId, cohortLocalDate: { lt: new Date('2026-08-01') } }, data: { coverage: 'complete' } })
    const template = await prisma.analyticsDailyMetric.findFirstOrThrow({ where: { businessId: f.businessId, metricKey: 'conversion', cohortLocalDate: { lt: new Date('2026-08-01') } } })
    await prisma.analyticsDailyMetric.updateMany({ where: { businessId: f.businessId, metricKey: 'conversion', cohortLocalDate: { lt: new Date('2026-08-01') } }, data: { numerator: 0 } })
    const { id: ignoredId, ...base } = template
    expect(ignoredId).toBeTruthy()
    await prisma.analyticsDailyMetric.createMany({ data: dates.slice(2, 28).map(cohortLocalDate => ({ ...base, cohortLocalDate, numerator: 0 })) })
    expect(await getOwnerAnalyticsReport(input, now)).toMatchObject({ comparison: { status: 'comparable', previousConversion: { numerator: 0, denominator: 56, rate: 0 }, deltaPercentagePoints: 50 } })
  })
})
