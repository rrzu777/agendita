import { randomUUID } from 'node:crypto'
import { prisma } from '@/lib/db'
import { requireAnalyticsTestDatabase } from './analytics-database'
requireAnalyticsTestDatabase()
export { prisma }
export async function seedAnalyticsReport(day = '2026-08-01', timezone = 'UTC') {
  const businessId = `analytics-report-${randomUUID()}`
  await prisma.business.create({ data: { id: businessId, name: 'Synthetic report', slug: businessId, subdomain: businessId, ownerUserId: 'synthetic', city: 'Santiago', timezone } })
  const startedAt = new Date(`${day}T12:00:00Z`)
  const retentionExpiresAt = new Date(startedAt.getTime() + 90 * 86400000)
  const identity = { businessId, definitionVersion: 1, businessTimeZone: timezone, cohortLocalDate: new Date(day), channel: 'instagram' as const, normalizationVersion: 1 }
  await prisma.analyticsCollectionPeriod.create({ data: { businessId, definitionVersion: 1, consentVersion: 1, businessTimeZone: timezone, startedAt: new Date(`${day}T00:00:00Z`) } })
  const session = await prisma.analyticsSession.create({ data: { ...identity, bootstrapKey: randomUUID(), origin: 'https://agendita.test', consentVersion: 1, startedAt, expiresAt: new Date(+startedAt + 86400000), retentionExpiresAt } })
  const attempt = await prisma.bookingFunnelAttempt.create({ data: { ...identity, sessionId: session.id, bootstrapKey: randomUUID(), origin: session.origin, startedAt, conversionDeadlineAt: session.expiresAt, retentionExpiresAt, entryKind: 'complete' } })
  const event = await prisma.bookingFunnelEvent.create({ data: { businessId, sessionId: session.id, attemptId: attempt.id, eventId: randomUUID(), version: 1, scope: 'attempt', type: 'service_considered', streamKey: `attempt:${attempt.id}`, sequence: 1, selectionRevision: 1, fingerprint: 'a'.repeat(64), data: { serviceId: 'historical-service' }, serviceId: 'historical-service', receivedAt: startedAt, retentionExpiresAt } })
  await prisma.bookingFunnelAttempt.update({ where: { id: attempt.id }, data: { acceptedEventCount: 1 } })
  const customer = await prisma.customer.create({ data: { businessId, name: 'Synthetic', phone: `test-${randomUUID()}` } })
  const service = await prisma.service.create({ data: { businessId, name: 'Synthetic', durationMinutes: 60, price: 0, depositAmount: 0, pastelColor: '#ffffff' } })
  const booking = await prisma.booking.create({ data: { businessId, customerId: customer.id, serviceId: service.id, startDateTime: new Date(+startedAt + 7200000), endDateTime: new Date(+startedAt + 10800000), createdAt: new Date(+startedAt + 60000), status: 'cancelled', totalPrice: 0, depositRequired: 0, remainingBalance: 0, finalAmount: 0, paymentStatus: 'unpaid', analyticsVersion: 1, analyticsSessionId: session.id, analyticsAttemptId: attempt.id, analyticsAttemptStartedAt: startedAt, analyticsConversionDeadlineAt: session.expiresAt, analyticsRetentionExpiresAt: retentionExpiresAt, analyticsChannel: 'instagram', analyticsNormalizationVersion: 1 } })
  return { businessId, session, attempt, event, booking, service, cohort: { businessId, localDate: day, timezone, definitionVersion: 1, now: new Date(+startedAt + 3 * 86400000) } }
}
