import { randomUUID } from 'node:crypto'
import { prisma } from '@/lib/db'
import { requireAnalyticsTestDatabase } from './analytics-database'
import { event } from './analytics-fixtures'
import type { ObservedEvent } from '@/lib/analytics/report-types'
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

/** Retained raw observations for dashboard G2, independent of illustrative daily cells. */
export async function seedAnalyticsFlowObservations(report: Awaited<ReturnType<typeof seedAnalyticsReport>>) {
  const context = { serviceId: report.service.id, modality: 'on_site', professional: { kind: 'person', professionalId: 'synthetic-professional' } }
  async function append(attempt: typeof report.attempt, events: ObservedEvent[], offset = 0) {
    await prisma.bookingFunnelEvent.createMany({ data: events.map(({ event: input }, index) => ({
      businessId: report.businessId, sessionId: attempt.sessionId, attemptId: attempt.id,
      eventId: randomUUID(), version: 1, scope: 'attempt', type: input.type,
      streamKey: `attempt:${attempt.id}`, sequence: offset + index + 1,
      selectionRevision: 'selectionRevision' in input ? input.selectionRevision : null,
      fingerprint: 'a'.repeat(64), data: input.data,
      receivedAt: new Date(+attempt.startedAt + index * 1000), retentionExpiresAt: attempt.retentionExpiresAt,
    })) })
    await prisma.bookingFunnelAttempt.update({ where: { id: attempt.id }, data: { acceptedEventCount: offset + events.length } })
  }
  await append(report.attempt, [
    event(2, 'service_selected', { ...context, professionalStepRequired: true }),
    event(3, 'professional_selected', context),
    event(4, 'date_selected', { ...context, localDate: '2026-09-15' }),
    event(5, 'availability_result', { ...context, localDate: '2026-09-15', queryId: randomUUID(), requestGeneration: 1, result: 'error' }),
    event(6, 'payment_branch_viewed', { screen: 'cobrar', condition: 'deposit_required', offeredMethods: ['online', 'transfer'] }),
    event(7, 'payment_method_selected', { method: 'transfer' }),
    event(8, 'promotion_result', { result: 'rejected', category: 'invalid' }),
    event(9, 'booking_submit_result', { result: 'error', category: 'network' }),
  ], 1)

  async function clone(entryKind: 'complete' | 'partial', events: ObservedEvent[], recent = false) {
    let session = report.session
    if (recent) {
      const startedAt = new Date(Date.now() - 5 * 60000)
      session = await prisma.analyticsSession.create({ data: {
        ...report.session, id: randomUUID(), bootstrapKey: randomUUID(), startedAt,
        cohortLocalDate: new Date(startedAt.toISOString().slice(0, 10)),
        expiresAt: new Date(+startedAt + 86400000), retentionExpiresAt: new Date(+startedAt + 90 * 86400000),
      } })
    }
    const attempt = await prisma.bookingFunnelAttempt.create({ data: {
      ...report.attempt, id: randomUUID(), bootstrapKey: randomUUID(), sessionId: session.id, entryKind,
      startedAt: session.startedAt, cohortLocalDate: session.cohortLocalDate,
      conversionDeadlineAt: session.expiresAt, retentionExpiresAt: session.retentionExpiresAt,
      acceptedEventCount: 0,
    } })
    await append(attempt, events)
  }
  await clone('complete', [
    event(1, 'service_selected', { ...context, professional: { kind: 'anyone' }, professionalStepRequired: false }),
    event(2, 'payment_branch_viewed', { screen: 'sin-abono', condition: 'package', offeredMethods: [] }),
  ])
  await clone('complete', [event(1, 'service_considered', { serviceId: report.service.id })])
  await clone('partial', [
    event(1, 'payment_branch_viewed', { screen: 'cobrar', condition: 'deposit_required', offeredMethods: ['manual'] }),
    event(2, 'payment_method_selected', { method: 'manual' }),
  ])
  for (let i = 0; i < 2; i++) await clone('complete', [event(1, 'step_viewed', { step: 'payment' })], true)
  for (let i = 0; i < 4; i++) await clone('partial', [event(1, 'payment_branch_viewed', { screen: 'verificando', condition: 'deposit_required', offeredMethods: [] })], true)
}
