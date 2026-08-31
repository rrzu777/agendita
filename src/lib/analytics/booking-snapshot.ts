import 'server-only'
import { credentialBookingSnapshot, verifyAnalyticsCredential } from './credential'
import { getAnalyticsCaptureConfig } from './budget'

export type VerifiedBookingAnalyticsSnapshot = NonNullable<ReturnType<typeof credentialBookingSnapshot>>

/** Purely local, fail-open boundary. Never reads analytics rows or changes a booking's financial equivalence. */
export function getBookingAnalyticsSnapshot(input: { credential: unknown; selectionRevision?: unknown; businessId: string; origin: string; now: Date }): VerifiedBookingAnalyticsSnapshot | null {
  try {
    const config = getAnalyticsCaptureConfig(input.businessId)
    if (!config || typeof input.credential !== 'string' || input.credential.length > 4096) return null
    const claims = verifyAnalyticsCredential(input.credential, { secret: config.secret, businessId: input.businessId, origin: input.origin, now: input.now })
    return credentialBookingSnapshot(claims, typeof input.selectionRevision === 'number' ? input.selectionRevision : undefined)
  } catch { return null }
}
