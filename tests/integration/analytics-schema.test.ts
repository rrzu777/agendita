import { PrismaClient, type Prisma } from '@prisma/client'
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// Deliberately stricter than the shared helper: BOTH URLs must identify this exclusive disposable database.
for (const key of ['DATABASE_URL', 'DIRECT_URL'] as const) {
  const raw = process.env[key]
  if (!raw) throw new Error(`${key} must be explicitly set for analytics schema tests`)
  const url = new URL(raw)
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.pathname !== '/agendita_owner_analytics_test' || process.env.NODE_ENV === 'production') throw new Error('Refusing non-exclusive analytics test database')
}
const prisma = new PrismaClient()
const businessId = `analytics-schema-${randomUUID()}`
const sessionId = randomUUID()
const sessionTwoId = randomUUID()
const attemptId = randomUUID()
const start = new Date('2026-08-01T00:00:00Z')
const end = new Date('2026-08-02T00:00:00Z')
const retention = new Date('2026-10-30T00:00:00Z')
const sessionData = { businessId, bootstrapKey: randomUUID(), origin: 'https://www.agendita.cl', consentVersion: 1, definitionVersion: 1, startedAt: start, expiresAt: end, retentionExpiresAt: retention, businessTimeZone: 'America/Santiago', cohortLocalDate: new Date('2026-07-31'), channel: 'direct' as const, normalizationVersion: 1 }
const eventData = () => ({ businessId, sessionId, attemptId, eventId: randomUUID(), version: 1, scope: 'attempt' as const, type: 'funnel_started' as const, streamKey: `attempt:${attemptId}`, sequence: 1, selectionRevision: 1, fingerprint: 'a'.repeat(64), data: {}, receivedAt: start, retentionExpiresAt: retention })
afterAll(async () => { await prisma.business.deleteMany({ where: { id: businessId } }); await prisma.$disconnect() })
describe('owner analytics PostgreSQL storage', () => {
  it('creates all six tenant-scoped storage entities additively', async () => {
    const rows = await prisma.$queryRaw<{ count: bigint }[]>`SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('AnalyticsSession', 'BookingFunnelAttempt', 'BookingFunnelEvent', 'AcquisitionLink', 'AnalyticsCollectionPeriod', 'AnalyticsDailyMetric')`
    expect(Number(rows[0].count)).toBe(6)
  })
})

describe('actual PostgreSQL tenant, scope, replay and nullable snapshot constraints', () => {
  beforeAll(async () => {
    await prisma.business.create({ data: { id: businessId, name: 'Synthetic analytics', slug: businessId, subdomain: businessId, ownerUserId: 'synthetic-owner', city: 'Santiago' } })
    await prisma.analyticsSession.create({ data: { ...sessionData, id: sessionId } })
    await prisma.analyticsSession.create({ data: { ...sessionData, id: sessionTwoId, bootstrapKey: randomUUID() } })
    await prisma.bookingFunnelAttempt.create({ data: { id: attemptId, businessId, sessionId, bootstrapKey: randomUUID(), origin: sessionData.origin, startedAt: start, conversionDeadlineAt: end, retentionExpiresAt: retention, entryKind: 'complete', definitionVersion: 1, businessTimeZone: sessionData.businessTimeZone, cohortLocalDate: sessionData.cohortLocalDate, channel: 'direct', normalizationVersion: 1 } })
  })

  it('rejects an event referencing another session of the same business', async () => {
    await expect(prisma.bookingFunnelEvent.create({ data: { ...eventData(), sessionId: sessionTwoId } })).rejects.toMatchObject({ code: 'P2003' })
  })
  it('rejects event-ID and stream-sequence collisions independently', async () => {
    const data = eventData()
    await prisma.bookingFunnelEvent.create({ data })
    await expect(prisma.bookingFunnelEvent.create({ data: { ...data, sequence: 2 } })).rejects.toMatchObject({ code: 'P2002' })
    await expect(prisma.bookingFunnelEvent.create({ data: { ...data, eventId: randomUUID() } })).rejects.toMatchObject({ code: 'P2002' })
  })
  it('rejects mismatched scope, free stream key, missing revision and invalid counts', async () => {
    for (const data of [
      { ...eventData(), sequence: 2, scope: 'session' as const },
      { ...eventData(), sequence: 2, streamKey: `attempt:${randomUUID()}` },
      { ...eventData(), sequence: 2, selectionRevision: null },
      { ...eventData(), sequence: 0 },
    ]) await expect(prisma.bookingFunnelEvent.create({ data })).rejects.toThrow()
    await expect(prisma.analyticsSession.update({ where: { id: sessionId }, data: { acceptedEventCount: 201 } })).rejects.toThrow()
    await expect(prisma.analyticsSession.update({ where: { id: sessionId }, data: { retentionExpiresAt: new Date('2027-01-01') } })).rejects.toThrow()
  })
  it('allows surface events only without attempt identity', async () => {
    const data = { ...eventData(), eventId: randomUUID(), attemptId: null, scope: 'session' as const, type: 'public_profile_viewed' as const, streamKey: `session:${sessionId}`, selectionRevision: null }
    await expect(prisma.bookingFunnelEvent.create({ data })).resolves.toMatchObject({ attemptId: null })
    await expect(prisma.bookingFunnelEvent.create({ data: { ...data, eventId: randomUUID(), sequence: 2, attemptId } })).rejects.toThrow()
  })
  it('enforces all-or-none Booking snapshot but never a conversion-window constraint on the reservation', async () => {
    const customer = await prisma.customer.create({ data: { businessId, name: 'Synthetic', phone: `test-${randomUUID()}` } })
    const service = await prisma.service.create({ data: { businessId, name: 'Synthetic', durationMinutes: 60, price: 0, depositAmount: 0, pastelColor: '#ffffff' } })
    const base: Prisma.BookingUncheckedCreateInput = { businessId, customerId: customer.id, serviceId: service.id, startDateTime: new Date('2026-09-01T12:00:00Z'), endDateTime: new Date('2026-09-01T13:00:00Z'), status: 'cancelled', totalPrice: 0, depositRequired: 0, remainingBalance: 0, finalAmount: 0, paymentStatus: 'unpaid' }
    const booking = await prisma.booking.create({ data: base })
    await expect(prisma.booking.update({ where: { id: booking.id }, data: { analyticsAttemptId: attemptId } })).rejects.toThrow()
    await expect(prisma.booking.update({ where: { id: booking.id }, data: { analyticsAcquisitionLinkId: 'unverified-link' } })).rejects.toThrow()
    const complete = { analyticsVersion: 1, analyticsSessionId: sessionId, analyticsAttemptId: attemptId, analyticsAttemptStartedAt: start, analyticsConversionDeadlineAt: end, analyticsRetentionExpiresAt: retention, analyticsChannel: 'direct' as const, analyticsNormalizationVersion: 1 }
    // Created after the conversion window: domain write succeeds; reducer excludes attribution.
    await expect(prisma.booking.update({ where: { id: booking.id }, data: complete })).resolves.toMatchObject({ analyticsAttemptId: attemptId })
    await expect(prisma.booking.create({ data: { ...base, ...complete } })).resolves.toMatchObject({ analyticsAttemptId: attemptId })
    await prisma.analyticsSession.delete({ where: { id: sessionId } })
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })).analyticsAttemptId).toBe(attemptId)
  })
  it('rejects null-equivalent daily keys, duplicate cells, negative counts and mixed metric grains', async () => {
    const data = { businessId, cohortLocalDate: new Date('2026-07-31'), businessTimeZone: 'America/Santiago', definitionVersion: 1, population: 'complete_attempts' as const, grain: 'total' as const, dimensionKey: 'total', metricKey: 'conversion', numerator: 1, denominator: 2, revision: 1, state: 'closed' as const, coverage: 'complete' as const, calculatedAt: end, cutoffAt: end, retentionExpiresAt: retention }
    const stored = await prisma.analyticsDailyMetric.create({ data })
    await expect(prisma.analyticsDailyMetric.create({ data })).rejects.toMatchObject({ code: 'P2002' })
    for (const changed of [{ dimensionKey: '' }, { numerator: -1 }, { grain: 'service' as const, dimensionKey: 'service-a' }, { population: 'sessions' as const }, { numerator: 3 }]) await expect(prisma.analyticsDailyMetric.update({ where: { id: stored.id }, data: changed })).rejects.toThrow()
    await expect(prisma.$executeRaw`INSERT INTO "AnalyticsDailyMetric" ("id", "businessId", "cohortLocalDate", "businessTimeZone", "definitionVersion", "population", "grain", "dimensionKey", "metricKey", "numerator", "denominator", "revision", "state", "coverage", "calculatedAt", "cutoffAt", "retentionExpiresAt") VALUES (${randomUUID()}::uuid, ${businessId}, '2026-07-31', 'America/Santiago', 1, 'sessions', 'total', NULL, 'visits', 0, 0, 1, 'closed', 'complete', NOW(), NOW(), NOW())`).rejects.toThrow()
  })
})
