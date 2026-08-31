import 'server-only'
import { createHash } from 'node:crypto'
import { z } from 'zod'
import { ANALYTICS_POLICY as policy } from './policy'
import { resolvePublicAnalyticsContext, type PublicAnalyticsContext } from './public-context'
import { getAnalyticsCaptureConfig, reserveAnalyticsBudget, checkAnalyticsRateLimit } from './budget'
import { getClientIp } from '@/lib/rate-limit'
import { analyticsEventSchema, dimensionIdSchema, eventScope } from './contracts'
import { normalizeAcquisition } from './attribution'
import { signAnalyticsCredential, verifyAnalyticsCredential, type AnalyticsClaims } from './credential'
import { formatInTimeZone } from 'date-fns-tz'
import { claimsForSession, claimsForAttempt, closeAnalyticsCollection, collectionIsOpen, eventDimensions, eventDimensionsBelong, withAnalyticsWrite } from '@/server/analytics/repository'

export type CaptureErrorCategory = 'invalid_request' | 'invalid_credential' | 'disabled' | 'expired' | 'conflict' | 'rate_limit' | 'budget' | 'unavailable'
export class AnalyticsCaptureError extends Error {
  constructor(readonly category: CaptureErrorCategory) { super(category); this.name = 'AnalyticsCaptureError' }
}

/** Read bounded bytes, not request.json()/text(): Content-Length can be absent or forged. */
export async function readAnalyticsBody(request: Request): Promise<unknown> {
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get('content-type') ?? '') || !request.body) throw new AnalyticsCaptureError('invalid_request')
  const declared = request.headers.get('content-length')
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > policy.batchBytes)) throw new AnalyticsCaptureError('invalid_request')
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > policy.batchBytes) {
        await reader.cancel().catch(() => {})
        throw new AnalyticsCaptureError('invalid_request')
      }
      chunks.push(value)
    }
    const bytes = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown
  } catch { throw new AnalyticsCaptureError('invalid_request') }
  finally { reader.releaseLock() }
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value !== null && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`
  return JSON.stringify(value)
}
export function canonicalAnalyticsFingerprint(input: unknown): string {
  return createHash('sha256').update(canonical(input)).digest('hex')
}

const batchSchema = z.strictObject({ credential: z.string().min(1).max(4096), events: z.array(z.unknown()).max(policy.batchEvents), captureGap: z.literal(true).optional() }).refine((value) => value.events.length > 0 || value.captureGap === true)
export function parseAnalyticsBatch(input: unknown) {
  const parsed = batchSchema.safeParse(input)
  if (!parsed.success) throw new AnalyticsCaptureError('invalid_request')
  return parsed.data
}

export interface AnalyticsBootstrapReceipt { id: string; credential: string; startedAt: string; expiresAt: string; retentionExpiresAt: string }
export type EventReceiptCategory = 'stored' | 'identical' | 'invalid_event' | 'wrong_scope' | 'foreign_dimension' | 'conflict' | 'stream_limit' | 'budget'
export interface BatchReceipt { receipts: { index: number; eventId: string | null; status: 'accepted' | 'replay' | 'rejected'; category: EventReceiptCategory }[]; captureGapRecorded?: true }

const tokenSchema = z.string().regex(/^[A-Za-z0-9_-]{22,64}$/)
const sessionSchema = z.strictObject({ bootstrapKey: z.uuid(), consent: z.literal(true), consentVersion: z.literal(1), acq: tokenSchema.optional(), utmSource: z.string().max(80).optional(), utmMedium: z.string().max(80).optional(), utmCampaign: z.string().max(128).optional(), referrerHost: z.string().max(253).regex(/^[a-z0-9.-]+$/i).optional() })
const attemptSchema = z.strictObject({ bootstrapKey: z.uuid(), credential: z.string().max(4096), entryKind: z.enum(['complete', 'partial']) })
export type AnalyticsSessionBootstrapInput = z.infer<typeof sessionSchema>
export type AnalyticsAttemptBootstrapInput = z.infer<typeof attemptSchema>
function configFor(context: PublicAnalyticsContext, now: Date) {
  const config = getAnalyticsCaptureConfig(context.businessId)
  if (!config || !Number.isFinite(now.getTime())) throw new AnalyticsCaptureError('disabled')
  return config
}
function bootstrapReceipt(claims: AnalyticsClaims, secret: string): AnalyticsBootstrapReceipt {
  return { id: claims.scope === 'attempt' ? claims.attemptId : claims.sessionId, credential: signAnalyticsCredential(claims, secret), startedAt: claims.scope === 'attempt' ? claims.attemptStartedAt : claims.sessionStartedAt, expiresAt: claims.scope === 'attempt' ? claims.conversionDeadlineAt : claims.sessionExpiresAt, retentionExpiresAt: claims.retentionExpiresAt }
}

export async function bootstrapAnalyticsSession(context: PublicAnalyticsContext, input: unknown, now = new Date()): Promise<AnalyticsBootstrapReceipt> {
  const config = configFor(context, now)
  const parsed = sessionSchema.safeParse(input)
  if (!parsed.success) throw new AnalyticsCaptureError('invalid_request')
  const data = parsed.data
  const claims = await withAnalyticsWrite(context.businessId, async (tx) => {
    if (!await collectionIsOpen(tx, context.businessId)) throw new AnalyticsCaptureError('disabled')
    const existing = await tx.analyticsSession.findUnique({ where: { businessId_bootstrapKey: { businessId: context.businessId, bootstrapKey: data.bootstrapKey } } })
    if (existing) {
      if (existing.origin !== context.origin) throw new AnalyticsCaptureError('conflict')
      if (existing.expiresAt <= now || existing.startedAt > now) throw new AnalyticsCaptureError('expired')
      return claimsForSession(existing)
    }
    if (!await reserveAnalyticsBudget({ businessId: context.businessId, cost: 1, now })) {
      await closeAnalyticsCollection(tx, context.businessId, now, 'budget')
      return null
    }
    const campaign = dimensionIdSchema.safeParse(data.utmCampaign)
    const link = data.acq || campaign.success ? await tx.acquisitionLink.findFirst({ where: { businessId: context.businessId, archivedAt: null, ...(data.acq ? { token: data.acq } : { id: campaign.success ? campaign.data : undefined }) }, select: { id: true, channel: true } }) : null
    const referrerChannels: Record<string, string> = { 'instagram.com': 'instagram', 'www.instagram.com': 'instagram', 'l.instagram.com': 'instagram', 'facebook.com': 'facebook', 'www.facebook.com': 'facebook', 'l.facebook.com': 'facebook', 'm.facebook.com': 'facebook', 'google.com': 'google', 'www.google.com': 'google', 'google.cl': 'google', 'www.google.cl': 'google', 'web.whatsapp.com': 'whatsapp', 'wa.me': 'whatsapp' }
    const host = data.referrerHost?.toLowerCase()
    const referrerChannel = host && Object.hasOwn(referrerChannels, host) ? referrerChannels[host] : undefined
    const mediumSource = data.utmMedium ? data.utmMedium.toLowerCase() === 'referral' ? 'referral' : 'unknown' : undefined
    const acquisition = normalizeAcquisition({ verifiedLink: link, utmSource: data.utmSource || referrerChannel || mediumSource, referrer: host })
    const created = await tx.analyticsSession.create({ data: { businessId: context.businessId, bootstrapKey: data.bootstrapKey, origin: context.origin, consentVersion: 1, definitionVersion: 1, startedAt: now, expiresAt: new Date(now.getTime() + policy.sessionWindowMs), retentionExpiresAt: new Date(now.getTime() + policy.rawRetentionMs), businessTimeZone: context.timezone, cohortLocalDate: new Date(formatInTimeZone(now, context.timezone, 'yyyy-MM-dd')), ...acquisition } })
    return claimsForSession(created)
  })
  if (!claims) throw new AnalyticsCaptureError('budget')
  return bootstrapReceipt(claims, config.secret)
}

export async function bootstrapAnalyticsAttempt(context: PublicAnalyticsContext, input: unknown, now = new Date()): Promise<AnalyticsBootstrapReceipt> {
  const config = configFor(context, now)
  const parsed = attemptSchema.safeParse(input)
  if (!parsed.success) throw new AnalyticsCaptureError('invalid_request')
  const data = parsed.data
  const verified = verifyAnalyticsCredential(data.credential, { secret: config.secret, businessId: context.businessId, origin: context.origin, now })
  if (!verified || verified.scope !== 'session') throw new AnalyticsCaptureError('invalid_credential')
  const claims = await withAnalyticsWrite(context.businessId, async (tx) => {
    if (!await collectionIsOpen(tx, context.businessId)) throw new AnalyticsCaptureError('disabled')
    const session = await tx.analyticsSession.findFirst({ where: { businessId: context.businessId, id: verified.sessionId, origin: context.origin } })
    if (!session || canonicalAnalyticsFingerprint(claimsForSession(session)) !== canonicalAnalyticsFingerprint(verified)) throw new AnalyticsCaptureError('invalid_credential')
    if (session.bootstrapKey === data.bootstrapKey.toLowerCase()) throw new AnalyticsCaptureError('conflict')
    const existing = await tx.bookingFunnelAttempt.findUnique({ where: { businessId_bootstrapKey: { businessId: context.businessId, bootstrapKey: data.bootstrapKey } } })
    if (existing) {
      if (existing.sessionId !== session.id || existing.origin !== context.origin || existing.entryKind !== data.entryKind) throw new AnalyticsCaptureError('conflict')
      if (existing.conversionDeadlineAt <= now || existing.startedAt > now) throw new AnalyticsCaptureError('expired')
      return claimsForAttempt(session, existing)
    }
    if (!await reserveAnalyticsBudget({ businessId: context.businessId, cost: 1, now })) {
      await closeAnalyticsCollection(tx, context.businessId, now, 'budget')
      return null
    }
    const created = await tx.bookingFunnelAttempt.create({ data: { businessId: context.businessId, sessionId: session.id, bootstrapKey: data.bootstrapKey, origin: context.origin, startedAt: now, conversionDeadlineAt: new Date(now.getTime() + policy.conversionWindowMs), retentionExpiresAt: session.retentionExpiresAt, entryKind: data.entryKind, definitionVersion: 1, businessTimeZone: context.timezone, cohortLocalDate: new Date(formatInTimeZone(now, context.timezone, 'yyyy-MM-dd')), channel: session.channel, normalizationVersion: session.normalizationVersion, acquisitionLinkId: session.acquisitionLinkId } })
    return claimsForAttempt(session, created)
  })
  if (!claims) throw new AnalyticsCaptureError('budget')
  return bootstrapReceipt(claims, config.secret)
}

export async function ingestAnalyticsBatch(context: PublicAnalyticsContext, input: unknown, now = new Date()): Promise<BatchReceipt> {
  const config = configFor(context, now)
  const data = parseAnalyticsBatch(input)
  const claims = verifyAnalyticsCredential(data.credential, { secret: config.secret, businessId: context.businessId, origin: context.origin, now })
  if (!claims) throw new AnalyticsCaptureError('invalid_credential')
  return withAnalyticsWrite(context.businessId, async (tx) => {
    if (!await collectionIsOpen(tx, context.businessId)) throw new AnalyticsCaptureError('disabled')
    const session = await tx.analyticsSession.findFirst({ where: { businessId: context.businessId, id: claims.sessionId, origin: context.origin } })
    const attempt = claims.scope === 'attempt' ? await tx.bookingFunnelAttempt.findFirst({ where: { businessId: context.businessId, sessionId: claims.sessionId, id: claims.attemptId, origin: context.origin } }) : null
    if (!session || (claims.scope === 'attempt' && !attempt) || canonicalAnalyticsFingerprint(attempt ? claimsForAttempt(session, attempt) : claimsForSession(session)) !== canonicalAnalyticsFingerprint(claims)) throw new AnalyticsCaptureError('invalid_credential')
    const streamKey = attempt ? `attempt:${attempt.id}` : `session:${session.id}`
    const stream = attempt ?? session
    let count = stream.acceptedEventCount
    let knownCaptureGap = stream.knownCaptureGap || data.captureGap === true
    const receipts: BatchReceipt['receipts'] = []
    const budget = await reserveAnalyticsBudget({ businessId: context.businessId, cost: Math.max(1, data.events.length), now })
    if (!budget) await closeAnalyticsCollection(tx, context.businessId, now, 'budget')
    for (const [index, raw] of data.events.entries()) {
      const parsed = analyticsEventSchema.safeParse(raw)
      const eventId = raw && typeof raw === 'object' && 'eventId' in raw && z.uuid().safeParse(raw.eventId).success ? raw.eventId as string : null
      let category: EventReceiptCategory = 'stored'
      if (!budget) category = 'budget'
      else if (!parsed.success) category = 'invalid_event'
      else if (eventScope(parsed.data.type) !== claims.scope) category = 'wrong_scope'
      else {
        // PostgreSQL UUID columns normalize casing; the fingerprint and identity comparison must agree.
        const event = { ...parsed.data, eventId: parsed.data.eventId.toLowerCase() }
        const fingerprint = canonicalAnalyticsFingerprint(event)
        const existing = await tx.bookingFunnelEvent.findFirst({ where: { businessId: context.businessId, OR: [{ eventId: event.eventId }, { streamKey, sequence: event.sequence }] } })
        if (existing) category = existing.streamKey === streamKey && existing.sessionId === session.id && existing.attemptId === (attempt?.id ?? null) && existing.eventId === event.eventId && existing.fingerprint === fingerprint ? 'identical' : 'conflict'
        else if (count >= policy.streamEvents) category = 'stream_limit'
        else if (!await eventDimensionsBelong(tx, context.businessId, event)) category = 'foreign_dimension'
        else {
          const { serviceId, modality, professionalId } = eventDimensions(event)
          await tx.bookingFunnelEvent.create({ data: { businessId: context.businessId, sessionId: session.id, attemptId: attempt?.id ?? null, eventId: event.eventId, version: event.version, scope: claims.scope, type: event.type, streamKey, sequence: event.sequence, selectionRevision: 'selectionRevision' in event ? event.selectionRevision : null, fingerprint, data: event.data, serviceId, modality, professionalId, receivedAt: now, retentionExpiresAt: session.retentionExpiresAt } })
          count++
        }
      }
      const status = category === 'stored' ? 'accepted' : category === 'identical' ? 'replay' : 'rejected'
      if (status === 'rejected') knownCaptureGap = true
      receipts.push({ index, eventId, status, category })
    }
    const update = { acceptedEventCount: count, knownCaptureGap }
    if (attempt) await tx.bookingFunnelAttempt.update({ where: { id: attempt.id }, data: update })
    else await tx.analyticsSession.update({ where: { id: session.id }, data: update })
    return { receipts, ...(data.captureGap ? { captureGapRecorded: true as const } : {}) }
  })
}

export async function handleAnalyticsPost(request: Request, slug: string, kind: 'session' | 'attempt' | 'events'): Promise<Response> {
  const headers = { 'Cache-Control': 'no-store' }
  try {
    const input = await readAnalyticsBody(request)
    const context = await resolvePublicAnalyticsContext(request, slug)
    if (!context) return Response.json({ category: 'disabled' }, { status: 403, headers })
    let identity: string
    if (kind === 'events') {
      const parsed = parseAnalyticsBatch(input)
      const config = configFor(context, new Date())
      const claims = verifyAnalyticsCredential(parsed.credential, { secret: config.secret, businessId: context.businessId, origin: context.origin, now: new Date() })
      if (!claims) throw new AnalyticsCaptureError('invalid_credential')
      identity = claims.scope === 'attempt' ? `attempt:${claims.attemptId}` : `session:${claims.sessionId}`
    } else identity = await getClientIp(request)
    if (!await checkAnalyticsRateLimit({ businessId: context.businessId, kind: kind === 'events' ? 'batch' : 'bootstrap', identity })) throw new AnalyticsCaptureError('rate_limit')
    const result = kind === 'session' ? await bootstrapAnalyticsSession(context, input) : kind === 'attempt' ? await bootstrapAnalyticsAttempt(context, input) : await ingestAnalyticsBatch(context, input)
    return Response.json(result, { headers })
  } catch (error) {
    const category = error instanceof AnalyticsCaptureError ? error.category : 'unavailable'
    const status = category === 'invalid_request' ? 400 : category === 'invalid_credential' || category === 'disabled' ? 403 : category === 'expired' || category === 'conflict' ? 409 : category === 'rate_limit' || category === 'budget' ? 429 : 503
    return Response.json({ category }, { status, headers })
  }
}
