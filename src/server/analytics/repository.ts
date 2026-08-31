import 'server-only'
import { prisma } from '@/lib/db'
import type { Prisma, AnalyticsSession, BookingFunnelAttempt } from '@prisma/client'
import type { AnalyticsClaims } from '@/lib/analytics/credential'
import { selectionContextSchema, type AnalyticsEventInput } from '@/lib/analytics/contracts'

/** Analytics-only lock, never taken by Booking. Serializes tenant event IDs, stream caps and operator transitions. */
export async function withAnalyticsWrite<T>(businessId: string, work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  for (let retry = 0; ; retry++) {
    try {
      return await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`owner-analytics:${businessId}`}, 0))`
        return work(tx)
      }, { maxWait: 5000, timeout: 15000 })
    } catch (error) {
      if (retry === 0 && error && typeof error === 'object' && 'code' in error && ['P2002', 'P2034'].includes(String(error.code))) continue
      throw error
    }
  }
}

export async function collectionIsOpen(tx: Prisma.TransactionClient, businessId: string) {
  return Boolean(await tx.analyticsCollectionPeriod.findFirst({ where: { businessId, endedAt: null, consentVersion: 1, definitionVersion: 1, business: { isActive: true } }, select: { id: true } }))
}

export async function closeAnalyticsCollection(tx: Prisma.TransactionClient, businessId: string, now: Date, closeReason: 'budget' | 'operator' | 'backlog') {
  return tx.analyticsCollectionPeriod.updateMany({ where: { businessId, endedAt: null }, data: { endedAt: now, closeReason } })
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
