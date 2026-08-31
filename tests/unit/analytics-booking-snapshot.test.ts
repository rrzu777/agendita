import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { signAnalyticsCredential } from '@/lib/analytics/credential'
import { getBookingAnalyticsSnapshot } from '@/lib/analytics/booking-snapshot'
import { captureClaims, captureNow, captureSecret, configureCapture } from '../helpers/analytics-capture'

describe('optional Booking analytics boundary', () => {
  beforeEach(() => configureCapture())
  afterEach(() => vi.unstubAllEnvs())
  const input = () => ({ credential: signAnalyticsCredential(captureClaims(), captureSecret), businessId: 'biz-a', origin: 'https://salon.agendita.test', now: captureNow, selectionRevision: 3 })
  it('copies only signed scalar claims with the original retention', () => {
    expect(getBookingAnalyticsSnapshot(input())).toMatchObject({ analyticsAttemptId: '13b83f98-9d17-44bd-b06b-23ea3ca9f19c', analyticsChannel: 'instagram', analyticsSelectionRevision: 3, analyticsRetentionExpiresAt: new Date('2026-11-29T10:00:00Z') })
  })
  it.each([null, 123, {}, [], 'invalid-signature', 'a'.repeat(5000)])('omits malformed credential %j without throwing', (credential) => {
    expect(getBookingAnalyticsSnapshot({ ...input(), credential })).toBeNull()
  })
  it('omits expired, cross-tenant and cross-origin credentials', () => {
    for (const extra of [{ now: new Date('2026-09-01T11:00:00Z') }, { businessId: 'biz-b' }, { origin: 'https://other.agendita.test' }]) expect(getBookingAnalyticsSnapshot({ ...input(), ...extra })).toBeNull()
  })
  it('invalid revision is discarded without losing valid signed attribution', () => {
    expect(getBookingAnalyticsSnapshot({ ...input(), selectionRevision: { unsafe: true } })).toMatchObject({ analyticsSelectionRevision: null })
  })
  it('a missing signing key or global kill switch omits analytics', () => {
    vi.stubEnv('OWNER_ANALYTICS_SECRET', '')
    expect(getBookingAnalyticsSnapshot(input())).toBeNull()
    vi.stubEnv('OWNER_ANALYTICS_SECRET', captureSecret)
    vi.stubEnv('OWNER_ANALYTICS_ENABLED', 'false')
    expect(getBookingAnalyticsSnapshot(input())).toBeNull()
  })
})
