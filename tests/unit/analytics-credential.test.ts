import { describe, expect, it } from 'vitest'
import { signAnalyticsCredential, verifyAnalyticsCredential, credentialBookingSnapshot } from '@/lib/analytics/credential'

const secret = 'synthetic-test-secret-with-at-least-32-bytes'
const claims = {
  version: 1 as const, scope: 'attempt' as const, businessId: 'business-a', sessionId: '59f1ff5d-bf6f-4b96-b6e0-1be52096731a', attemptId: '59f1ff5d-bf6f-4b96-b6e0-1be52096731b',
  origin: 'https://www.agendita.cl', consentVersion: 1 as const, definitionVersion: 1 as const,
  sessionStartedAt: '2026-08-01T00:00:00.000Z', sessionExpiresAt: '2026-08-02T00:00:00.000Z',
  attemptStartedAt: '2026-08-01T23:00:00.000Z', conversionDeadlineAt: '2026-08-02T23:00:00.000Z',
  retentionExpiresAt: '2026-10-30T00:00:00.000Z',
  acquisition: { channel: 'instagram' as const, normalizationVersion: 1 as const, acquisitionLinkId: null },
}
const options = { secret, businessId: 'business-a', origin: 'https://www.agendita.cl', now: new Date('2026-08-02T01:00:00Z') }
describe('signed analytics credentials', () => {
  it('retains attempt validity after session expiry and copies verified attribution', () => {
    const verified = verifyAnalyticsCredential(signAnalyticsCredential(claims, secret), options)
    expect(verified).toEqual(claims)
    expect(credentialBookingSnapshot(verified, 2)).toMatchObject({ analyticsAttemptId: claims.attemptId, analyticsChannel: 'instagram', analyticsSelectionRevision: 2 })
  })
  it('rejects altered, expired, wrong-tenant, wrong-origin and malformed credentials', () => {
    const token = signAnalyticsCredential(claims, secret)
    for (const invalid of [token + 'x', 'invalid', token.replace(/.$/, '!')]) expect(verifyAnalyticsCredential(invalid, options)).toBeNull()
    expect(verifyAnalyticsCredential(token, { ...options, businessId: 'other' })).toBeNull()
    expect(verifyAnalyticsCredential(token, { ...options, origin: 'https://other.invalid' })).toBeNull()
    expect(verifyAnalyticsCredential(token, { ...options, now: new Date(claims.conversionDeadlineAt) })).toBeNull()
  })
  it('never permits a session credential to produce a Booking snapshot', () => {
    const session = { version: claims.version, scope: 'session' as const, businessId: claims.businessId, sessionId: claims.sessionId, origin: claims.origin, consentVersion: claims.consentVersion, definitionVersion: claims.definitionVersion, sessionStartedAt: claims.sessionStartedAt, sessionExpiresAt: claims.sessionExpiresAt, retentionExpiresAt: claims.retentionExpiresAt, acquisition: claims.acquisition }
    const verified = verifyAnalyticsCredential(signAnalyticsCredential(session, secret), { ...options, now: new Date('2026-08-01T01:00:00Z') })
    expect(verified?.scope).toBe('session')
    expect(credentialBookingSnapshot(verified)).toBeNull()
  })
  it('rejects inconsistent signed lifetimes and secrets without sufficient entropy length', () => {
    expect(() => signAnalyticsCredential({ ...claims, conversionDeadlineAt: '2026-08-03T23:00:00.000Z' }, secret)).toThrow()
    expect(() => signAnalyticsCredential(claims, 'short')).toThrow()
  })
})
