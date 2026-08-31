import { vi } from 'vitest'
import type { AnalyticsClaims } from '@/lib/analytics/credential'

export const captureNow = new Date('2026-08-31T12:00:00.000Z')
export const captureSecret = 'synthetic-owner-analytics-secret-32-bytes'
export function configureCapture(businessId = 'biz-a') {
  for (const [key, value] of Object.entries({
    OWNER_ANALYTICS_ENABLED: 'true', OWNER_ANALYTICS_BUSINESS_IDS: businessId,
    OWNER_ANALYTICS_SECRET: captureSecret, OWNER_ANALYTICS_PRIVACY_APPROVED: 'true',
    OWNER_ANALYTICS_PILOT_APPROVED: 'true', OWNER_ANALYTICS_GLOBAL_DAILY_BUDGET: '1000',
    OWNER_ANALYTICS_TENANT_DAILY_BUDGET: '500', OWNER_ANALYTICS_VERIFIED_DAILY_DRAIN: '2000',
    UPSTASH_REDIS_REST_URL: 'https://redis.example.invalid', UPSTASH_REDIS_REST_TOKEN: 'synthetic',
    NEXT_PUBLIC_APP_DOMAIN: 'agendita.test',
  })) vi.stubEnv(key, value)
}
export function captureClaims(): AnalyticsClaims {
  return {
    version: 1, scope: 'attempt', businessId: 'biz-a', origin: 'https://salon.agendita.test',
    sessionId: '74d2b4a1-c53a-41d5-a145-5318f1d2d382', attemptId: '13b83f98-9d17-44bd-b06b-23ea3ca9f19c',
    consentVersion: 1, definitionVersion: 1, sessionStartedAt: '2026-08-31T10:00:00.000Z',
    sessionExpiresAt: '2026-09-01T10:00:00.000Z', attemptStartedAt: '2026-08-31T11:00:00.000Z',
    conversionDeadlineAt: '2026-09-01T11:00:00.000Z', retentionExpiresAt: '2026-11-29T10:00:00.000Z',
    acquisition: { channel: 'instagram', normalizationVersion: 1, acquisitionLinkId: null },
  }
}

export function liveCaptureClaims(businessId = 'biz-a', origin = 'https://salon.agendita.test'): AnalyticsClaims {
  const startedAt = Date.now() - 60000
  return { ...captureClaims(), scope: 'attempt', businessId, origin, attemptId: '13b83f98-9d17-44bd-b06b-23ea3ca9f19c', sessionStartedAt: new Date(startedAt).toISOString(), sessionExpiresAt: new Date(startedAt + 86400000).toISOString(), attemptStartedAt: new Date(startedAt).toISOString(), conversionDeadlineAt: new Date(startedAt + 86400000).toISOString(), retentionExpiresAt: new Date(startedAt + 90 * 86400000).toISOString() }
}
