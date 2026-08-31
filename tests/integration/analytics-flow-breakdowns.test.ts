import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { prisma, seedAnalyticsReport } from '../helpers/analytics-report-db'
import { getOwnerAnalyticsReport } from '@/server/analytics/reports'
import { publishAnalyticsCohort } from '@/server/analytics/maintenance'
import { event } from '../helpers/analytics-fixtures'
import type { ObservedEvent } from '@/lib/analytics/report-types'

const auth = vi.hoisted(() => vi.fn())
vi.mock('@/lib/auth/user', () => ({ getCurrentUserWithBusiness: auth }))
const ids: string[] = []
let boundaryFault: 'event_version' | 'attempt_version' | 'session_version' | 'marker_version' | 'query_error' | null = null
let detailEventQueries = 0
// Future versions cannot currently be persisted (DB CHECKs enforce v1). Inject
// those future rows only at the query boundary, preserving every real DB read.
prisma.$use(async (params, next) => {
  if (params.runInTransaction && params.model === 'BookingFunnelEvent' && params.action === 'findMany') detailEventQueries++
  if (boundaryFault === 'query_error' && params.runInTransaction && params.model === 'BookingFunnelAttempt' && params.action === 'findMany') {
    params.args.where.id = 'invalid-uuid-for-query-failure'
  }
  const result = await next(params)
  if (params.action !== 'findMany' || !Array.isArray(result)) return result
  if (boundaryFault === 'event_version' && params.model === 'BookingFunnelEvent') return result.map(row => ({ ...row, version: 2 }))
  if ((boundaryFault === 'attempt_version' && params.model === 'BookingFunnelAttempt') || (boundaryFault === 'session_version' && params.model === 'AnalyticsSession') || (boundaryFault === 'marker_version' && params.model === 'AnalyticsDailyMetric')) return result.map(row => ({ ...row, definitionVersion: 2 }))
  return result
})
const period = { from: '2026-08-01', to: '2026-08-02' }
type Fixture = Awaited<ReturnType<typeof seedAnalyticsReport>>
async function fixture() {
  const f = await seedAnalyticsReport(); ids.push(f.businessId)
  auth.mockResolvedValue({ user: { id: 'synthetic' }, role: 'owner', business: { id: f.businessId, timezone: 'UTC', slug: f.businessId } })
  return f
}
async function replaceEvents(f: Fixture, events: ObservedEvent[], acceptedCount = events.length) {
  await prisma.bookingFunnelEvent.deleteMany({ where: { businessId: f.businessId, attemptId: f.attempt.id } })
  await prisma.bookingFunnelEvent.createMany({ data: events.map(e => ({ ...f.event, id: randomUUID(), eventId: randomUUID(), sequence: e.event.sequence, type: e.event.type, selectionRevision: 'selectionRevision' in e.event ? e.event.selectionRevision : null, data: e.event.data, receivedAt: e.receivedAt })) })
  await prisma.bookingFunnelAttempt.update({ where: { id: f.attempt.id }, data: { acceptedEventCount: acceptedCount } })
}
afterEach(() => { boundaryFault = null; detailEventQueries = 0; vi.restoreAllMocks(); vi.unstubAllEnvs() })
afterAll(async () => { await prisma.business.deleteMany({ where: { id: { in: ids } } }); await prisma.$disconnect() })

describe('retained flow report PostgreSQL boundary', () => {
  it('returns observed partial payment and minimal enum DTO without identities from either tenant', async () => {
    const other = await fixture()
    const f = await fixture()
    await prisma.bookingFunnelAttempt.update({ where: { id: f.attempt.id }, data: { entryKind: 'partial' } })
    await replaceEvents(f, [event(1, 'payment_branch_viewed', { screen: 'cobrar', condition: 'deposit_required', offeredMethods: ['online', 'manual'] }), event(2, 'payment_method_selected', { method: 'manual' })])
    const report = await getOwnerAnalyticsReport(period, f.cohort.now)
    expect(report.flowBreakdowns).toMatchObject({ status: 'available', ...period, cutoffAt: f.cohort.now.toISOString(), timezones: ['UTC'], scope: 'all_attempts' })
    expect(report.flowBreakdowns.groups).toHaveLength(4)
    expect(report.flowBreakdowns.groups?.[2]).toMatchObject({ entryKind: 'partial', maturity: 'mature', attempts: 1, professional: { not_observed: 1 }, screen: { cobrar: 1 }, selectedMethod: { manual: 1 }, offeredMethods: { manual: 1, online: 1 } })
    const json = JSON.stringify(report.flowBreakdowns)
    for (const value of [f.businessId, f.attempt.id, f.session.id, f.event.id, other.businessId, 'professionalId', 'customerId', 'token', 'origin', 'receivedAt']) expect(json).not.toContain(value)
  })
  it('allows admin and rejects staff, missing sessions, foreign filters and filter intersections', async () => {
    const f = await fixture(), other = await seedAnalyticsReport(); ids.push(other.businessId)
    const link = await prisma.acquisitionLink.create({ data: { businessId: other.businessId, channel: 'direct', campaignName: 'Foreign', token: randomUUID() } })
    auth.mockResolvedValue({ user: { id: 'synthetic' }, role: 'admin', business: { id: f.businessId, timezone: 'UTC' } })
    expect((await getOwnerAnalyticsReport(period, f.cohort.now)).flowBreakdowns.status).toBe('available')
    for (const extra of [{ businessId: other.businessId }, { serviceId: other.service.id }, { acquisitionLinkId: link.id }, { channel: 'instagram', serviceId: f.service.id }]) await expect(getOwnerAnalyticsReport({ ...period, ...extra }, f.cohort.now)).rejects.toThrow()
    auth.mockResolvedValue({ user: { id: 'synthetic' }, role: 'staff', business: { id: f.businessId, timezone: 'UTC' } })
    await expect(getOwnerAnalyticsReport(period, f.cohort.now)).rejects.toThrow()
    auth.mockResolvedValue(null)
    await expect(getOwnerAnalyticsReport(period, f.cohort.now)).rejects.toThrow()
  })
  it('filters immutable acquisition and final service, never considered or previously selected services', async () => {
    const f = await fixture()
    const b = await prisma.service.create({ data: { businessId: f.businessId, name: 'Final', durationMinutes: 60, price: 0, depositAmount: 0, pastelColor: '#ffffff' } })
    const link = await prisma.acquisitionLink.create({ data: { businessId: f.businessId, channel: 'instagram', campaignName: 'Own', token: randomUUID() } })
    await prisma.bookingFunnelAttempt.update({ where: { id: f.attempt.id }, data: { acquisitionLinkId: link.id } })
    const context = { serviceId: f.service.id, modality: 'on_site', professional: { kind: 'none' } }
    await replaceEvents(f, [event(1, 'service_considered', { serviceId: f.service.id }), event(2, 'service_selected', { ...context, professionalStepRequired: false }), event(3, 'selection_context_changed', { reason: 'service', context: { ...context, serviceId: b.id }, localDate: null }, 2)])
    expect((await getOwnerAnalyticsReport({ ...period, serviceId: f.service.id }, f.cohort.now)).flowBreakdowns).toMatchObject({ status: 'empty', scope: 'final_service' })
    for (const filter of [{ serviceId: b.id }, { channel: 'instagram' }, { acquisitionLinkId: link.id }]) expect((await getOwnerAnalyticsReport({ ...period, ...filter }, f.cohort.now)).flowBreakdowns.groups?.[0].attempts).toBe(1)
    expect((await getOwnerAnalyticsReport({ ...period, channel: 'direct' }, f.cohort.now)).flowBreakdowns).toMatchObject({ status: 'empty', scope: 'channel' })
  })
  it('uses frozen source date and timezone, with exclusive period end and the exact server cutoff', async () => {
    const f = await fixture()
    auth.mockResolvedValue({ user: { id: 'synthetic' }, role: 'owner', business: { id: f.businessId, timezone: 'America/Santiago' } })
    const start = new Date('2026-08-01T00:30:00Z'), cutoff = new Date('2026-08-01T05:00:00Z')
    const expiresAt = new Date(+start + 86400000), retentionExpiresAt = new Date(+start + 90 * 86400000)
    await prisma.analyticsSession.update({ where: { id: f.session.id }, data: { startedAt: start, expiresAt, retentionExpiresAt } })
    await prisma.bookingFunnelAttempt.update({ where: { id: f.attempt.id }, data: { startedAt: start, conversionDeadlineAt: expiresAt, retentionExpiresAt } })
    const observed = event(1, 'payment_branch_viewed', { screen: 'sin-abono', condition: 'package', offeredMethods: [] }); observed.receivedAt = cutoff
    const future = event(2, 'payment_branch_viewed', { screen: 'cobrar', condition: 'deposit_required', offeredMethods: ['online'] }); future.receivedAt = new Date(+cutoff + 1)
    await replaceEvents(f, [observed, future])
    const report = await getOwnerAnalyticsReport(period, cutoff)
    expect(report.flowBreakdowns).toMatchObject({ timezones: ['UTC'], cutoffAt: cutoff.toISOString(), groups: [expect.anything(), expect.objectContaining({ attempts: 1, screen: expect.objectContaining({ 'sin-abono': 1, cobrar: 0 }) }), expect.anything(), expect.anything()] })
    expect((await getOwnerAnalyticsReport({ from: '2026-07-31', to: '2026-08-01' }, cutoff)).flowBreakdowns.status).toBe('empty')
  })
  it('does not widen a preset detail period to today or include later-starting sources', async () => {
    const f = await fixture(), cutoff = new Date('2026-08-01T11:00:00Z')
    expect((await getOwnerAnalyticsReport(period, cutoff)).flowBreakdowns.status).toBe('empty')
    const preset = await getOwnerAnalyticsReport({ days: 7 }, new Date('2026-08-01T15:00:00Z'))
    expect(preset.flowBreakdowns).toMatchObject({ status: 'empty', from: '2026-07-25', to: '2026-08-01' })
    expect(preset.recent.complete.attempts).toBe(1)
    expect(f.businessId).toBeTruthy()
  })
  it.each(['session', 'attempt', 'event'] as const)('reports pre-purge expired %s rows as not retained, even when filtered out', async source => {
    const f = await fixture(), data = { retentionExpiresAt: f.cohort.now }
    if (source === 'session') {
      // Session retention is exactly start+90d, enforced by PostgreSQL.
      await prisma.bookingFunnelAttempt.delete({ where: { id: f.attempt.id } })
      f.cohort.now = f.session.retentionExpiresAt
    }
    if (source === 'attempt') await prisma.bookingFunnelAttempt.update({ where: { id: f.attempt.id }, data })
    if (source === 'event') await prisma.bookingFunnelEvent.update({ where: { id: f.event.id }, data })
    expect((await getOwnerAnalyticsReport({ ...period, channel: 'direct' }, f.cohort.now)).flowBreakdowns).toMatchObject({ status: 'not_retained', groups: null })
  })
  it('honors a frozen publication marker after every raw source has been removed', async () => {
    const f = await fixture()
    await publishAnalyticsCohort(f.cohort)
    await prisma.analyticsDailyMetric.updateMany({ where: { businessId: f.businessId, metricKey: '__publication__' }, data: { frozenAt: f.cohort.now } })
    await prisma.analyticsSession.deleteMany({ where: { businessId: f.businessId } })
    const report = await getOwnerAnalyticsReport(period, f.cohort.now)
    expect(report.flowBreakdowns).toMatchObject({ status: 'not_retained', groups: null, timezones: ['UTC'] })
    expect(report.complete.conversion.numerator).toBe(1)
  })
  it.each(['missing_event', 'bad_payload', 'event_version', 'attempt_version', 'session_version', 'marker_version'] as const)('returns no partial counts for %s, even outside the selected channel', async corruption => {
    const f = await fixture()
    if (corruption === 'missing_event') await prisma.bookingFunnelAttempt.update({ where: { id: f.attempt.id }, data: { acceptedEventCount: 2 } })
    if (corruption === 'bad_payload') await prisma.bookingFunnelEvent.update({ where: { id: f.event.id }, data: { data: { customerEmail: 'private@example.invalid' } } })
    if (corruption === 'marker_version') await publishAnalyticsCohort(f.cohort)
    if (corruption !== 'missing_event' && corruption !== 'bad_payload') boundaryFault = corruption
    expect((await getOwnerAnalyticsReport({ ...period, channel: 'direct' }, f.cohort.now)).flowBreakdowns).toMatchObject({ status: 'incomplete_source', groups: null })
  })
  it('keeps sequence gaps as observation quality and session-only traffic as empty attempts', async () => {
    const f = await fixture()
    await replaceEvents(f, [event(3, 'payment_branch_viewed', { screen: 'verificando', condition: 'deposit_required', offeredMethods: [] })])
    expect((await getOwnerAnalyticsReport(period, f.cohort.now)).flowBreakdowns.groups?.[0]).toMatchObject({ attempts: 1, incompleteCapture: 1, screen: { verificando: 1 } })
    await prisma.bookingFunnelAttempt.delete({ where: { id: f.attempt.id } })
    const report = await getOwnerAnalyticsReport(period, f.cohort.now)
    expect(report.flowBreakdowns.status).toBe('empty')
    expect(report.flowBreakdowns.groups?.map(g => g.attempts)).toEqual([0, 0, 0, 0])
  })
  it('retains a valid historical summary when only the detail transaction query rejects', async () => {
    const f = await fixture()
    await publishAnalyticsCohort(f.cohort)
    // A past cohort keeps source findMany exclusive to the detail transaction.
    boundaryFault = 'query_error'
    const report = await getOwnerAnalyticsReport(period, f.cohort.now)
    expect(report.complete.conversion).toEqual({ numerator: 1, denominator: 1, rate: 1 })
    expect(report.flowBreakdowns).toMatchObject({ status: 'error', groups: null })
  })
  it('rejects the 10001st combined source before loading event streams or applying filters', async () => {
    const f = await fixture()
    await prisma.bookingFunnelAttempt.createMany({ data: Array.from({ length: 9998 }, () => ({ ...f.attempt, id: randomUUID(), bootstrapKey: randomUUID(), acceptedEventCount: 0 })) })
    expect((await getOwnerAnalyticsReport(period, f.cohort.now)).flowBreakdowns.status).toBe('available')
    await prisma.analyticsSession.create({ data: { ...f.session, id: randomUUID(), bootstrapKey: randomUUID() } })
    detailEventQueries = 0
    const report = await getOwnerAnalyticsReport({ ...period, channel: 'direct' }, f.cohort.now)
    expect(report.flowBreakdowns).toMatchObject({ status: 'limit_exceeded', groups: null })
    expect(detailEventQueries).toBe(0)
  }, 30000)
  it('rejects 201 events on one attempt and a 10001-event page sentinel without returning a prefix', async () => {
    const f = await fixture()
    await replaceEvents(f, Array.from({ length: 201 }, (_, i) => event(i + 1, 'step_viewed', { step: 'payment' })), 200)
    expect((await getOwnerAnalyticsReport(period, f.cohort.now)).flowBreakdowns).toMatchObject({ status: 'limit_exceeded', groups: null })
    // One corrupt stream fills the page sentinel; the reader must not silently truncate it.
    await prisma.$executeRaw`INSERT INTO "BookingFunnelEvent" (id, "businessId", "sessionId", "attemptId", "eventId", version, scope, type, "streamKey", sequence, "selectionRevision", fingerprint, data, "receivedAt", "retentionExpiresAt")
      SELECT gen_random_uuid(), a."businessId", a."sessionId", a.id, gen_random_uuid(), 1, 'attempt'::"AnalyticsEventScope", 'step_viewed'::"AnalyticsEventType", 'attempt:' || a.id::text, s, 1, repeat('a', 64), '{"step":"payment"}'::jsonb, a."startedAt", a."retentionExpiresAt"
      FROM "BookingFunnelAttempt" a CROSS JOIN generate_series(202, 10001) s WHERE a.id = ${f.attempt.id}::uuid`
    expect((await getOwnerAnalyticsReport(period, f.cohort.now)).flowBreakdowns).toMatchObject({ status: 'limit_exceeded', groups: null })
  }, 30000)
  it('accepts exactly 50000 events but discards the entire detail on the 50001st, including previous pages', async () => {
    const f = await fixture()
    await replaceEvents(f, [])
    const attempts = Array.from({ length: 250 }, () => ({ ...f.attempt, id: randomUUID(), bootstrapKey: randomUUID(), acceptedEventCount: 200 }))
    await prisma.bookingFunnelAttempt.createMany({ data: attempts })
    await prisma.$executeRaw`INSERT INTO "BookingFunnelEvent" (id, "businessId", "sessionId", "attemptId", "eventId", version, scope, type, "streamKey", sequence, "selectionRevision", fingerprint, data, "receivedAt", "retentionExpiresAt")
      SELECT gen_random_uuid(), a."businessId", a."sessionId", a.id, gen_random_uuid(), 1, 'attempt'::"AnalyticsEventScope", 'step_viewed'::"AnalyticsEventType", 'attempt:' || a.id::text, s, 1, repeat('a', 64), '{"step":"payment"}'::jsonb, a."startedAt", a."retentionExpiresAt"
      FROM "BookingFunnelAttempt" a CROSS JOIN generate_series(1, 200) s WHERE a."businessId" = ${f.businessId} AND a."acceptedEventCount" = 200`
    expect((await getOwnerAnalyticsReport(period, f.cohort.now)).flowBreakdowns.status).toBe('available')
    await replaceEvents(f, [event(1, 'step_viewed', { step: 'payment' })])
    expect((await getOwnerAnalyticsReport(period, f.cohort.now)).flowBreakdowns).toMatchObject({ status: 'limit_exceeded', groups: null })
  }, 30000)
})
