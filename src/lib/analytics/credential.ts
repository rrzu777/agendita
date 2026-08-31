import 'server-only'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import { acquisitionSchema, dimensionIdSchema } from './contracts'
import { ANALYTICS_POLICY as policy } from './policy'

export function normalizeAnalyticsOrigin(value: string): string | null {
  try {
    const url = new URL(value)
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') return null
    return url.origin
  } catch { return null }
}
const timestamp = z.iso.datetime({ precision: 3 })
const common = {
  version: z.literal(1), businessId: dimensionIdSchema, sessionId: z.uuid(),
  origin: z.string().max(300).refine((origin) => normalizeAnalyticsOrigin(origin) === origin),
  consentVersion: z.literal(1), definitionVersion: z.literal(1), sessionStartedAt: timestamp,
  sessionExpiresAt: timestamp, retentionExpiresAt: timestamp, acquisition: acquisitionSchema,
}
export const analyticsClaimsSchema = z.discriminatedUnion('scope', [
  z.strictObject({ ...common, scope: z.literal('session') }),
  z.strictObject({ ...common, scope: z.literal('attempt'), attemptId: z.uuid(), attemptStartedAt: timestamp, conversionDeadlineAt: timestamp }),
]).refine((claims) => {
  const start = Date.parse(claims.sessionStartedAt)
  const end = Date.parse(claims.sessionExpiresAt)
  if (end - start !== policy.sessionWindowMs || Date.parse(claims.retentionExpiresAt) - start !== policy.rawRetentionMs) return false
  return claims.scope === 'session' || (Date.parse(claims.attemptStartedAt) >= start && Date.parse(claims.attemptStartedAt) < end && Date.parse(claims.conversionDeadlineAt) - Date.parse(claims.attemptStartedAt) === policy.conversionWindowMs)
})
export type AnalyticsClaims = z.infer<typeof analyticsClaimsSchema>
function validSecret(secret: string): boolean { return Buffer.byteLength(secret, 'utf8') >= 32 }
export function signAnalyticsCredential(claims: AnalyticsClaims, secret: string): string {
  if (!validSecret(secret)) throw new Error('Analytics signing secret must contain at least 32 bytes')
  const payload = Buffer.from(JSON.stringify(analyticsClaimsSchema.parse(claims))).toString('base64url')
  return `${payload}.${createHmac('sha256', secret).update(payload).digest('base64url')}`
}
type VerificationContext = { secret: string; businessId: string; origin: string; now: Date }
/** Internal authenticity only; callers below impose their distinct temporal contract. */
function authenticClaims(token: string, options: VerificationContext): AnalyticsClaims | null {
  if (!validSecret(options.secret) || token.length > 4096 || !Number.isFinite(options.now.getTime())) return null
  const parts = token.split('.')
  if (parts.length !== 2 || !parts.every((part) => /^[A-Za-z0-9_-]+$/.test(part))) return null
  const [payload, signature] = parts
  const expected = createHmac('sha256', options.secret).update(payload).digest()
  const supplied = Buffer.from(signature, 'base64url')
  if (supplied.length !== expected.length || supplied.toString('base64url') !== signature || !timingSafeEqual(supplied, expected)) return null
  try {
    const parsed = analyticsClaimsSchema.safeParse(JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')))
    if (!parsed.success) return null
    const claims = parsed.data
    if (claims.businessId !== options.businessId || claims.origin !== normalizeAnalyticsOrigin(options.origin)) return null
    return claims
  } catch { return null }
}
export function verifyAnalyticsCredential(token: string, options: VerificationContext): AnalyticsClaims | null {
  const claims = authenticClaims(token, options)
  if (!claims) return null
  const start = Date.parse(claims.scope === 'attempt' ? claims.attemptStartedAt : claims.sessionStartedAt)
  const end = Date.parse(claims.scope === 'attempt' ? claims.conversionDeadlineAt : claims.sessionExpiresAt)
  return options.now.getTime() >= start && options.now.getTime() < end ? claims : null
}

/** Not an event/Booking credential. Only bootstrap may use this binding, after
 * checking the original DB claims and an already-existing, still-live attempt. */
export function verifyExpiredAnalyticsParentForRecovery(token: string, options: VerificationContext): Extract<AnalyticsClaims, { scope: 'session' }> | null {
  const claims = authenticClaims(token, options)
  if (!claims || claims.scope !== 'session') return null
  const expiredAt = Date.parse(claims.sessionExpiresAt)
  return options.now.getTime() >= expiredAt && options.now.getTime() < expiredAt + policy.conversionWindowMs ? claims : null
}
/** Call only with the result of verifyAnalyticsCredential at the booking boundary. No database dependency. */
export function credentialBookingSnapshot(claims: AnalyticsClaims | null, selectionRevision?: number) {
  if (!claims || claims.scope !== 'attempt') return null
  return {
    analyticsVersion: claims.version, analyticsSessionId: claims.sessionId, analyticsAttemptId: claims.attemptId,
    analyticsAttemptStartedAt: new Date(claims.attemptStartedAt), analyticsConversionDeadlineAt: new Date(claims.conversionDeadlineAt),
    analyticsRetentionExpiresAt: new Date(claims.retentionExpiresAt), analyticsChannel: claims.acquisition.channel,
    analyticsNormalizationVersion: claims.acquisition.normalizationVersion, analyticsAcquisitionLinkId: claims.acquisition.acquisitionLinkId,
    analyticsSelectionRevision: Number.isInteger(selectionRevision) && selectionRevision! > 0 && selectionRevision! <= 2147483647 ? selectionRevision! : null,
  }
}
