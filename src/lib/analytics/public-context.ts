import 'server-only'
import { prisma } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth/user'
import { getAppUrl, getBusinessPublicUrl } from '@/lib/business/urls'
import { normalizeAnalyticsOrigin } from './credential'
import { getAnalyticsCaptureConfig } from './budget'
import { ANALYTICS_POLICY } from './policy'

export interface PublicAnalyticsContext {
  businessId: string
  slug: string
  timezone: string
  origin: string
}

/** Rendering hint only: no identity or network writes. The POST boundary still verifies origin. */
export async function isPublicAnalyticsEligible(businessId: string): Promise<boolean> {
  try {
    if (!getAnalyticsCaptureConfig(businessId)) return false
    const business = await prisma.business.findUnique({ where: { id: businessId }, select: { isActive: true } })
    if (!business?.isActive) return false
    const period = await prisma.analyticsCollectionPeriod.findFirst({ where: { businessId, endedAt: null, definitionVersion: 1, consentVersion: 1 }, select: { id: true } })
    if (!period || await hasAnalyticsRetentionBacklog()) return false
    const user = await getCurrentUser()
    return !user || !await prisma.businessUser.findFirst({ where: { businessId, userId: user.id }, select: { id: true } })
  } catch { return false }
}

/** Uses each global retention index. Missing cleanup capacity must never silently enable capture. */
export async function hasAnalyticsRetentionBacklog(now = new Date()): Promise<boolean> {
  const rows = await prisma.$queryRaw<{ oldest: Date | null }[]>`
    SELECT MIN(expiry) AS oldest FROM (
      (SELECT "retentionExpiresAt" AS expiry FROM "AnalyticsSession" ORDER BY "retentionExpiresAt", id LIMIT 1)
      UNION ALL (SELECT "retentionExpiresAt" FROM "BookingFunnelAttempt" ORDER BY "retentionExpiresAt", id LIMIT 1)
      UNION ALL (SELECT "retentionExpiresAt" FROM "BookingFunnelEvent" ORDER BY "retentionExpiresAt", id LIMIT 1)
      UNION ALL (SELECT "analyticsRetentionExpiresAt" FROM "Booking" WHERE "analyticsRetentionExpiresAt" IS NOT NULL ORDER BY "analyticsRetentionExpiresAt", id LIMIT 1)
      UNION ALL (SELECT "retentionExpiresAt" FROM "AnalyticsDailyMetric" ORDER BY "retentionExpiresAt", id LIMIT 1)
    ) AS expiries
  `
  return Boolean(rows[0]?.oldest && rows[0].oldest.getTime() <= now.getTime() - ANALYTICS_POLICY.backlogPauseMs)
}

/** No trust in x-business-subdomain/x-forwarded-host: /api bypasses the proxy's sanitation. */
export async function resolvePublicAnalyticsContext(request: Request, slug: string): Promise<PublicAnalyticsContext | null> {
  try {
    if (!/^[a-z0-9-]{1,128}$/.test(slug) || process.env.OWNER_ANALYTICS_ENABLED !== 'true') return null
    const rawOrigin = request.headers.get('origin') ?? ''
    const origin = normalizeAnalyticsOrigin(rawOrigin)
    const url = new URL(request.url)
    if (!origin || origin !== rawOrigin || origin !== url.origin || (request.headers.has('host') && request.headers.get('host') !== url.host)) return null
    if (request.headers.has('x-owner-analytics-probe') || /bot|crawler|spider|headless|uptime|probe/i.test(request.headers.get('user-agent') ?? '')) return null
    if (!process.env.NEXT_PUBLIC_APP_DOMAIN && !process.env.APP_DOMAIN) return null
    const business = await prisma.business.findUnique({ where: { slug }, select: { id: true, slug: true, subdomain: true, customDomain: true, isActive: true, timezone: true } })
    if (!business?.isActive || !getAnalyticsCaptureConfig(business.id)) return null
    new Intl.DateTimeFormat('en', { timeZone: business.timezone }).format()
    const origins = new Set([new URL(getAppUrl()).origin, new URL(getBusinessPublicUrl(business)).origin])
    if (business.customDomain) {
      const custom = normalizeAnalyticsOrigin(`https://${business.customDomain}`)
      if (custom) origins.add(custom)
    }
    if (!origins.has(origin)) return null
    const period = await prisma.analyticsCollectionPeriod.findFirst({ where: { businessId: business.id, endedAt: null, definitionVersion: 1, consentVersion: 1 }, select: { id: true } })
    if (!period || await hasAnalyticsRetentionBacklog()) return null
    const user = await getCurrentUser()
    if (user && await prisma.businessUser.findFirst({ where: { businessId: business.id, userId: user.id }, select: { id: true } })) return null
    return { businessId: business.id, slug: business.slug, timezone: business.timezone, origin }
  } catch { return null }
}
