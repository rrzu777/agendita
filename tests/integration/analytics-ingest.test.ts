import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { requireAnalyticsTestDatabase } from '../helpers/analytics-database'
import { configureCapture, captureNow } from '../helpers/analytics-capture'
import { bootstrapAnalyticsSession, bootstrapAnalyticsAttempt, ingestAnalyticsBatch } from '@/lib/analytics/ingest'
import { prisma } from '@/lib/db'
import { verifyAnalyticsCredential } from '@/lib/analytics/credential'
import { captureSecret } from '../helpers/analytics-capture'
import { createAnalyticsStore } from '@/lib/analytics/client-store'
import { createAnalyticsTransport } from '@/lib/analytics/client-transport'
import { getBookingAnalyticsSnapshot } from '@/lib/analytics/booking-snapshot'
import { formatInTimeZone } from 'date-fns-tz'
import { POST as sessionPOST } from '@/app/api/analytics/[slug]/session/route'
import { POST as attemptPOST } from '@/app/api/analytics/[slug]/attempt/route'
import { POST as eventsPOST } from '@/app/api/analytics/[slug]/events/route'

requireAnalyticsTestDatabase()
const execute = vi.hoisted(() => vi.fn())
vi.mock('@/lib/upstash-rest', () => ({ executeUpstashCommand: execute }))
vi.mock('@/lib/auth/user', () => ({ getCurrentUser: async () => null }))
const businessId = `capture-${randomUUID()}`
const context = { businessId, slug: businessId, origin: 'https://agendita.test', timezone: 'America/Santiago' }
const sessionInput = () => ({ bootstrapKey: randomUUID(), consent: true, consentVersion: 1 })
const event = (sequence: number, extra = {}) => ({ version: 1, eventId: randomUUID(), sequence, selectionRevision: 1, type: 'step_viewed', data: { step: 'service' }, ...extra })
async function boot() {
  const session = await bootstrapAnalyticsSession(context, sessionInput(), captureNow)
  expect(session).toHaveProperty('credential')
  const attempt = await bootstrapAnalyticsAttempt(context, { bootstrapKey: randomUUID(), credential: session.credential, entryKind: 'complete' }, captureNow)
  expect(attempt).toHaveProperty('credential')
  return { session, attempt }
}

describe('real PostgreSQL bootstrap and ingest serialization', () => {
  beforeAll(async () => {
    await prisma.business.create({ data: { id: businessId, slug: businessId, subdomain: businessId, name: 'Synthetic capture', ownerUserId: 'synthetic-owner', city: 'Santiago' } })
    await prisma.business.create({ data: { id: `${businessId}-foreign`, slug: `${businessId}-foreign`, subdomain: `${businessId}-foreign`, name: 'Synthetic foreign', ownerUserId: 'synthetic-owner', city: 'Santiago' } })
    for (const tenant of [businessId, `${businessId}-foreign`]) {
      await prisma.service.create({ data: { id: `${tenant}-service`, businessId: tenant, name: 'Synthetic', durationMinutes: 30, price: 0, depositAmount: 0, pastelColor: '#ffffff' } })
      await prisma.professional.create({ data: { id: `${tenant}-professional`, businessId: tenant, name: 'Synthetic' } })
      await prisma.promotion.create({ data: { id: `${tenant}-promotion`, businessId: tenant, name: 'Synthetic', rewardType: 'fixed_amount', rewardValue: 1 } })
    }
  })
  beforeEach(async () => {
    configureCapture(businessId); execute.mockReset().mockResolvedValue(1)
    await prisma.analyticsSession.deleteMany({ where: { businessId } })
    await prisma.analyticsCollectionPeriod.deleteMany({ where: { businessId } })
    await prisma.analyticsCollectionPeriod.create({ data: { businessId, definitionVersion: 1, consentVersion: 1, businessTimeZone: context.timezone, startedAt: captureNow } })
  })
  afterEach(() => vi.unstubAllEnvs())
  afterAll(async () => { await prisma.business.deleteMany({ where: { id: { in: [businessId, `${businessId}-foreign`] } } }); await prisma.$disconnect() })

  it('concurrent session retries and a lost response recover one row and identical credential', async () => {
    const input = sessionInput()
    const [a, b] = await Promise.all([bootstrapAnalyticsSession(context, input, captureNow), bootstrapAnalyticsSession(context, input, captureNow)])
    expect(a).toHaveProperty('credential'); expect(a).toEqual(b)
    expect(await bootstrapAnalyticsSession(context, { ...input, utmSource: 'facebook' }, new Date(captureNow.getTime() + 1000))).toEqual(a)
    expect(await prisma.analyticsSession.count({ where: { businessId } })).toBe(1)
  })
  it('recovers the committed attempt through the real client after its parent expires and never resurrects withdrawal', async () => {
    let clock = captureNow.getTime()
    const values = new Map<string, string>()
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) }, removeItem: (key: string) => { values.delete(key) } }
    const store = createAnalyticsStore({ businessId, origin: context.origin, storage, preferences: storage, now: () => clock })
    store.chooseConsent(true); store.open(); store.view({ type: 'booking_entry_viewed', data: {} }, 'entry')
    let lost = true
    let committed: Awaited<ReturnType<typeof bootstrapAnalyticsAttempt>> | undefined
    const fetcher = vi.fn(async (url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string)
      if (url.endsWith('/session')) return Response.json(await bootstrapAnalyticsSession(context, body, new Date(clock)))
      if (url.endsWith('/attempt')) {
        const result = await bootstrapAnalyticsAttempt(context, body, new Date(clock))
        if (lost) { lost = false; committed = result; throw new Error('synthetic response lost after PostgreSQL commit') }
        return Response.json(result)
      }
      return Response.json(await ingestAnalyticsBatch(context, body, new Date(clock)))
    })
    const transport = createAnalyticsTransport(store, businessId, { fetcher })
    await transport.flush()
    const parent = store.snapshot()!.streams[0].receipt!
    clock = Date.parse(parent.expiresAt) - 1000
    store.startAttempt('complete'); await transport.flush()
    expect(await prisma.bookingFunnelAttempt.count({ where: { businessId } })).toBe(1)
    expect(store.bookingCredential()).toBeUndefined()
    clock += 5000; await transport.flush()
    expect(store.bookingCredential()?.credential === committed!.credential).toBe(true)
    expect(JSON.stringify(store.snapshot()!.streams.find(s => s.kind === 'attempt')!.receipt) === JSON.stringify(committed)).toBe(true)
    expect(fetcher.mock.calls.filter(([url]) => url.endsWith('/attempt'))).toHaveLength(2)
    expect(await prisma.bookingFunnelAttempt.count({ where: { businessId } })).toBe(1)
    expect(verifyAnalyticsCredential(parent.credential, { businessId, origin: context.origin, secret: captureSecret, now: new Date(clock) })).toBeNull()
    expect(getBookingAnalyticsSnapshot({ credential: parent.credential, businessId, origin: context.origin, now: new Date(clock) })).toBeNull()
    expect(getBookingAnalyticsSnapshot({ credential: committed!.credential, businessId, origin: context.origin, now: new Date(committed!.expiresAt) })).toBeNull()
    await expect(ingestAnalyticsBatch(context, { credential: parent.credential, events: [], captureGap: true }, new Date(clock))).rejects.toMatchObject({ category: 'invalid_credential' })
    store.withdrawConsent(); transport.stop(); clock += 5000; await transport.flush()
    expect(store.snapshot()).toBeNull(); expect(store.bookingCredential()).toBeUndefined()
    expect(fetcher.mock.calls.filter(([url]) => url.endsWith('/attempt'))).toHaveLength(2)
  })
  it('recovers a committed bootstrap after a crash before catch using the persisted store across parent expiry', async () => {
    let clock = captureNow.getTime()
    const values = new Map<string, string>()
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) }, removeItem: (key: string) => { values.delete(key) } }
    const options = { businessId, origin: context.origin, storage, preferences: storage, now: () => clock }
    const store = createAnalyticsStore(options)
    store.chooseConsent(true); store.open(); store.view({ type: 'booking_entry_viewed', data: {} }, 'entry')
    let committed: Awaited<ReturnType<typeof bootstrapAnalyticsAttempt>> | undefined
    let reachedCommit!: () => void
    let releaseLostResponse!: () => void
    const ready = new Promise<void>(resolve => { reachedCommit = resolve })
    const fetcher = vi.fn(async (url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string)
      if (url.endsWith('/session')) return Response.json(await bootstrapAnalyticsSession(context, body, new Date(clock)))
      if (url.endsWith('/attempt')) {
        const result = await bootstrapAnalyticsAttempt(context, body, new Date(clock))
        if (!committed) {
          committed = result
          reachedCommit()
          return new Promise<Response>(resolve => { releaseLostResponse = () => resolve(Response.json(result)) })
        }
        return Response.json(result)
      }
      return Response.json(await ingestAnalyticsBatch(context, body, new Date(clock)))
    })
    const transport = createAnalyticsTransport(store, businessId, { fetcher })
    await transport.flush()
    const parent = store.snapshot()!.streams[0].receipt!
    clock = Date.parse(parent.expiresAt) - 1000
    store.startAttempt('complete')
    const oldFlight = transport.flush()
    await ready // DB committed, but no response/rejection/catch ran in the client.
    const original = store.snapshot()!.streams.find(s => s.kind === 'attempt')!
    expect(original.retries).toBe(0); expect(original.receipt).toBeUndefined()
    expect(await prisma.bookingFunnelAttempt.count({ where: { businessId } })).toBe(1)
    transport.stop(); store.stop()
    clock += 5000
    const restored = createAnalyticsStore(options)
    expect(restored.open()).toBe(true)
    const recovery = createAnalyticsTransport(restored, businessId, { fetcher })
    try {
      await recovery.flush()
      expect(restored.bookingCredential()?.credential === committed!.credential).toBe(true)
      expect(restored.snapshot()!.streams.find(s => s.key === original.key)!.receipt?.expiresAt).toBe(committed!.expiresAt)
      expect(fetcher.mock.calls.filter(([url]) => url.endsWith('/attempt'))).toHaveLength(2)
      expect(await prisma.bookingFunnelAttempt.count({ where: { businessId } })).toBe(1)
      expect(await prisma.analyticsSession.count({ where: { businessId } })).toBe(1)
      restored.withdrawConsent(); recovery.stop()
      const denied = createAnalyticsStore(options)
      expect(denied.open()).toBe(false); expect(denied.bookingCredential()).toBeUndefined()
    } finally { recovery.stop(); transport.stop(); releaseLostResponse(); await oldFlight }
  })
  it('gap-only controls persist atomically, replay idempotently and cost budget without event rows', async () => {
    const { attempt } = await boot()
    const input = { credential: attempt.credential, events: [], captureGap: true }
    expect(await ingestAnalyticsBatch(context, input, captureNow)).toEqual({ receipts: [], captureGapRecorded: true })
    expect(execute.mock.calls.at(-1)![0].args[6]).toBe(1)
    expect(await ingestAnalyticsBatch(context, input, captureNow)).toEqual({ receipts: [], captureGapRecorded: true })
    expect(await prisma.bookingFunnelAttempt.findUnique({ where: { id: attempt.id } })).toMatchObject({ knownCaptureGap: true, acceptedEventCount: 0 })
    expect(await prisma.bookingFunnelEvent.count({ where: { businessId } })).toBe(0)
    await expect(ingestAnalyticsBatch({ ...context, origin: 'https://elsewhere.test' }, input, captureNow)).rejects.toMatchObject({ category: 'invalid_credential' })
    await expect(ingestAnalyticsBatch(context, { ...input, credential: 'forged' }, captureNow)).rejects.toMatchObject({ category: 'invalid_credential' })
    configureCapture(`${businessId}-foreign`)
    await expect(ingestAnalyticsBatch({ ...context, businessId: `${businessId}-foreign` }, input, captureNow)).rejects.toMatchObject({ category: 'invalid_credential' })
    configureCapture(businessId)
    execute.mockResolvedValue(0)
    expect(await ingestAnalyticsBatch(context, input, captureNow)).toEqual({ receipts: [], captureGapRecorded: true })
    expect(await prisma.analyticsCollectionPeriod.findFirst({ where: { businessId, endedAt: { not: null } } })).toMatchObject({ closeReason: 'budget' })
  })
  it.each(['absent', 'wrong-entry', 'other-session', 'foreign-business', 'wrong-origin', 'tampered', 'changed-db-claims', 'deadline', 'outer-bound', 'future-attempt', 'before-session', 'after-session', 'closed-period', 'config-off'] as const)('rejects expired-parent recovery for %s without creating or extending an attempt', async kind => {
    const session = await bootstrapAnalyticsSession(context, sessionInput(), captureNow)
    const bootstrapKey = randomUUID()
    const startedAt = new Date(+captureNow + 86400000 - 1000)
    const original = await bootstrapAnalyticsAttempt(context, { bootstrapKey, credential: session.credential, entryKind: 'complete' }, startedAt)
    const input = { bootstrapKey, credential: session.credential, entryKind: 'complete' }
    let now = new Date(+captureNow + 86400000 + 1000)
    let target = context
    if (kind === 'absent') input.bootstrapKey = randomUUID()
    if (kind === 'wrong-entry') input.entryKind = 'partial'
    if (kind === 'other-session') input.credential = (await bootstrapAnalyticsSession(context, sessionInput(), captureNow)).credential
    if (kind === 'foreign-business') { target = { ...context, businessId: `${businessId}-foreign` }; configureCapture(target.businessId) }
    if (kind === 'wrong-origin') target = { ...context, origin: 'https://elsewhere.test' }
    if (kind === 'tampered') input.credential = 'x' + input.credential.slice(1)
    if (kind === 'changed-db-claims') await prisma.analyticsSession.update({ where: { id: session.id }, data: { channel: 'facebook' } })
    if (kind === 'deadline') now = new Date(original.expiresAt)
    if (kind === 'outer-bound') now = new Date(+captureNow + 2 * 86400000)
    if (kind === 'future-attempt' || kind === 'before-session' || kind === 'after-session') {
      const invalidStart = kind === 'future-attempt' ? new Date(+now + 1) : kind === 'before-session' ? new Date(+captureNow - 1) : new Date(session.expiresAt)
      await prisma.bookingFunnelAttempt.update({ where: { id: original.id }, data: { startedAt: invalidStart, conversionDeadlineAt: new Date(+invalidStart + 86400000), retentionExpiresAt: new Date(Math.min(Date.parse(session.retentionExpiresAt), +invalidStart + 90 * 86400000)), cohortLocalDate: new Date(formatInTimeZone(invalidStart, context.timezone, 'yyyy-MM-dd')) } })
    }
    if (kind === 'closed-period') await prisma.analyticsCollectionPeriod.updateMany({ where: { businessId }, data: { endedAt: now, closeReason: 'operator' } })
    if (kind === 'config-off') vi.stubEnv('OWNER_ANALYTICS_ENABLED', 'false')
    const deadlineBefore = (await prisma.bookingFunnelAttempt.findUniqueOrThrow({ where: { id: original.id } })).conversionDeadlineAt
    await expect(bootstrapAnalyticsAttempt(target, input, now)).rejects.toBeDefined()
    expect(await prisma.bookingFunnelAttempt.count({ where: { businessId } })).toBe(1)
    expect((await prisma.bookingFunnelAttempt.findUniqueOrThrow({ where: { id: original.id } })).conversionDeadlineAt).toEqual(deadlineBefore)
  })
  it('requires consent and current version; expired bootstrap identity cannot be reused', async () => {
    await expect(bootstrapAnalyticsSession(context, { ...sessionInput(), consent: false }, captureNow)).rejects.toMatchObject({ category: 'invalid_request' })
    await expect(bootstrapAnalyticsSession(context, { ...sessionInput(), consentVersion: 2 }, captureNow)).rejects.toMatchObject({ category: 'invalid_request' })
    const input = sessionInput()
    await bootstrapAnalyticsSession(context, input, captureNow)
    await expect(bootstrapAnalyticsSession(context, input, new Date(captureNow.getTime() + 86400000))).rejects.toMatchObject({ category: 'expired' })
  })
  it('attempt bootstrap requires its own key, same session and origin on replay', async () => {
    const input = sessionInput()
    const session = await bootstrapAnalyticsSession(context, input, captureNow)
    expect(session).toHaveProperty('credential')
    const attemptInput = { bootstrapKey: randomUUID(), credential: session.credential, entryKind: 'partial' }
    const [a, b] = await Promise.all([bootstrapAnalyticsAttempt(context, attemptInput, captureNow), bootstrapAnalyticsAttempt(context, attemptInput, captureNow)])
    expect(a).toEqual(b)
    await expect(bootstrapAnalyticsAttempt(context, { ...attemptInput, bootstrapKey: input.bootstrapKey }, captureNow)).rejects.toMatchObject({ category: 'conflict' })
    const other = await bootstrapAnalyticsSession(context, sessionInput(), captureNow)
    await expect(bootstrapAnalyticsAttempt(context, { ...attemptInput, credential: other.credential }, captureNow)).rejects.toMatchObject({ category: 'conflict' })
    await expect(bootstrapAnalyticsSession({ ...context, origin: 'https://elsewhere.test' }, input, captureNow)).rejects.toMatchObject({ category: 'conflict' })
    expect(await prisma.bookingFunnelAttempt.count({ where: { businessId } })).toBe(1)
  })
  it('accepts one copy concurrently, replays identical reordered payload and rejects ID/sequence collisions', async () => {
    const { attempt } = await boot()
    const first = event(1)
    const replies = await Promise.all([1, 2].map(() => ingestAnalyticsBatch(context, { credential: attempt.credential, events: [first] }, captureNow)))
    expect(replies.flatMap((r) => r.receipts.map((x) => x.status)).sort()).toEqual(['accepted', 'replay'])
    const reordered = { data: first.data, type: first.type, sequence: first.sequence, eventId: first.eventId, selectionRevision: 1, version: 1 }
    expect((await ingestAnalyticsBatch(context, { credential: attempt.credential, events: [reordered] }, captureNow)).receipts[0].status).toBe('replay')
    const conflicts = await ingestAnalyticsBatch(context, { credential: attempt.credential, events: [{ ...first, data: { step: 'time' } }, event(1)] }, captureNow)
    expect(conflicts.receipts.map((r) => r.category)).toEqual(['conflict', 'conflict'])
    expect(await prisma.bookingFunnelEvent.count({ where: { businessId } })).toBe(1)
    expect(await prisma.bookingFunnelAttempt.findUnique({ where: { id: attempt.id } })).toMatchObject({ acceptedEventCount: 1, knownCaptureGap: true })
  })
  it.each(['session', 'attempt'] as const)('keeps the 200-event %s cap under concurrent final batches and accepts replays at the cap', async (scope) => {
    const streams = await boot()
    const credential = streams[scope].credential
    const events = Array.from({ length: 220 }, (_, index) => scope === 'attempt' ? event(index + 1) : { version: 1, eventId: randomUUID(), sequence: index + 1, type: 'booking_entry_viewed', data: {} })
    for (let i = 0; i < 180; i += 20) await ingestAnalyticsBatch(context, { credential, events: events.slice(i, i + 20) }, captureNow)
    const final = await Promise.all([180, 200].map((i) => ingestAnalyticsBatch(context, { credential, events: events.slice(i, i + 20) }, captureNow)))
    expect(final.flatMap((r) => r.receipts).filter((r) => r.status === 'accepted')).toHaveLength(20)
    expect(final.flatMap((r) => r.receipts).filter((r) => r.category === 'stream_limit')).toHaveLength(20)
    expect(await prisma.bookingFunnelEvent.count({ where: { businessId, scope } })).toBe(200)
    expect((await ingestAnalyticsBatch(context, { credential, events: [events[0]] }, captureNow)).receipts[0].status).toBe('replay')
  })
  it('rejects real foreign service/professional/promotion IDs but accepts tenant-owned dimensions', async () => {
    const { attempt } = await boot()
    const result = await ingestAnalyticsBatch(context, { credential: attempt.credential, events: [
      event(1, { type: 'service_considered', data: { serviceId: `${businessId}-foreign-service` } }),
      event(2, { type: 'service_selected', data: { serviceId: `${businessId}-service`, modality: 'on_site', professional: { kind: 'person', professionalId: `${businessId}-foreign-professional` }, professionalStepRequired: true } }),
      event(3, { type: 'promotion_result', data: { result: 'accepted', promotionId: `${businessId}-foreign-promotion` } }),
      event(4, { type: 'service_selected', data: { serviceId: `${businessId}-service`, modality: 'on_site', professional: { kind: 'person', professionalId: `${businessId}-professional` }, professionalStepRequired: true } }),
    ] }, captureNow)
    expect(result.receipts.map((r) => r.category)).toEqual(['foreign_dimension', 'foreign_dimension', 'foreign_dimension', 'stored'])
    expect(await prisma.bookingFunnelEvent.findFirst({ where: { businessId } })).toMatchObject({ serviceId: `${businessId}-service`, professionalId: `${businessId}-professional` })
  })
  it('validates dimensions by tenant, rejects arbitrary fields and keeps session/attempt streams separate', async () => {
    const { session, attempt } = await boot()
    const result = await ingestAnalyticsBatch(context, { credential: attempt.credential, events: [event(1, { type: 'service_considered', data: { serviceId: 'foreign-service' } }), event(2, { data: { step: 'service', email: 'never-persist@example.test' } }), { version: 1, eventId: randomUUID(), sequence: 3, type: 'booking_entry_viewed', data: {} }] }, captureNow)
    expect(result.receipts.map((r) => r.category)).toEqual(['foreign_dimension', 'invalid_event', 'wrong_scope'])
    expect(await prisma.bookingFunnelEvent.count({ where: { businessId } })).toBe(0)
    const surface = { version: 1, eventId: randomUUID(), sequence: 1, type: 'booking_entry_viewed', data: {} }
    expect((await ingestAnalyticsBatch(context, { credential: session.credential, events: [surface] }, captureNow)).receipts[0].status).toBe('accepted')
    expect(await prisma.analyticsSession.findUnique({ where: { id: session.id } })).toMatchObject({ acceptedEventCount: 1 })
    await expect(ingestAnalyticsBatch({ ...context, businessId: 'foreign' }, { credential: attempt.credential, events: [event(4)] }, captureNow)).rejects.toBeDefined()
  })
  it('does not accept expired/invalid credentials and disabling collection stops existing streams', async () => {
    const { attempt } = await boot()
    await expect(ingestAnalyticsBatch(context, { credential: 'invalid', events: [event(1)] }, captureNow)).rejects.toMatchObject({ category: 'invalid_credential' })
    await expect(ingestAnalyticsBatch(context, { credential: attempt.credential, events: [event(1)] }, new Date(captureNow.getTime() + 86400000))).rejects.toMatchObject({ category: 'invalid_credential' })
    await prisma.analyticsCollectionPeriod.updateMany({ where: { businessId }, data: { endedAt: captureNow, closeReason: 'operator' } })
    await expect(ingestAnalyticsBatch(context, { credential: attempt.credential, events: [event(1)] }, captureNow)).rejects.toMatchObject({ category: 'disabled' })
    expect(await prisma.bookingFunnelEvent.count({ where: { businessId } })).toBe(0)
  })
  it('budget denial closes coverage and writes no events', async () => {
    const { attempt } = await boot()
    execute.mockResolvedValue(0)
    const result = await ingestAnalyticsBatch(context, { credential: attempt.credential, events: [event(1)] }, captureNow)
    expect(result.receipts[0].category).toBe('budget')
    expect(await prisma.analyticsCollectionPeriod.findFirst({ where: { businessId } })).toMatchObject({ endedAt: captureNow, closeReason: 'budget' })
    expect(await prisma.bookingFunnelEvent.count({ where: { businessId } })).toBe(0)
  })
  it('same event ID and canonical body in another same-tenant attempt is a conflict, not a replay', async () => {
    const a = await boot(), b = await boot()
    const first = event(1)
    await ingestAnalyticsBatch(context, { credential: a.attempt.credential, events: [first] }, captureNow)
    const reply = await ingestAnalyticsBatch(context, { credential: b.attempt.credential, events: [first] }, captureNow)
    expect(reply.receipts[0]).toMatchObject({ status: 'rejected', category: 'conflict' })
    expect(await prisma.bookingFunnelAttempt.findUnique({ where: { id: b.attempt.id } })).toMatchObject({ acceptedEventCount: 0, knownCaptureGap: true })
  })
  it('upper-case UUID spellings cannot bypass independent bootstrap keys', async () => {
    const bootstrapKey = randomUUID().toUpperCase()
    const session = await bootstrapAnalyticsSession(context, { ...sessionInput(), bootstrapKey }, captureNow)
    await expect(bootstrapAnalyticsAttempt(context, { bootstrapKey, credential: session.credential, entryKind: 'complete' }, captureNow)).rejects.toMatchObject({ category: 'conflict' })
  })
  it('an identical replay with an upper-case event UUID remains a replay after PostgreSQL normalization', async () => {
    const { attempt } = await boot()
    const uppercase = event(1, { eventId: randomUUID().toUpperCase() })
    await ingestAnalyticsBatch(context, { credential: attempt.credential, events: [uppercase] }, captureNow)
    expect((await ingestAnalyticsBatch(context, { credential: attempt.credential, events: [uppercase] }, captureNow)).receipts[0].status).toBe('replay')
  })
  it('free-text UTM campaigns become unknown without discarding a recognized channel', async () => {
    const receipt = await bootstrapAnalyticsSession(context, { ...sessionInput(), utmSource: 'instagram', utmCampaign: 'Spring special campaign' }, captureNow)
    const claims = verifyAnalyticsCredential(receipt.credential, { businessId, origin: context.origin, secret: captureSecret, now: captureNow })
    expect(claims?.acquisition).toEqual({ channel: 'instagram', acquisitionLinkId: null, normalizationVersion: 1 })
  })
  it('a UTM medium alone cannot be mislabeled as direct traffic', async () => {
    const receipt = await bootstrapAnalyticsSession(context, { ...sessionInput(), utmMedium: 'social' }, captureNow)
    expect(verifyAnalyticsCredential(receipt.credential, { businessId, origin: context.origin, secret: captureSecret, now: captureNow })?.acquisition.channel).toBe('unknown')
  })
  it('archiving a link blocks new attribution without rewriting the first source of an existing session', async () => {
    const link = await prisma.acquisitionLink.create({ data: { businessId, token: randomUUID().replaceAll('-', ''), channel: 'instagram', campaignName: 'Synthetic season' } })
    const input = { ...sessionInput(), acq: link.token, utmSource: 'facebook' }
    const first = await bootstrapAnalyticsSession(context, input, captureNow)
    await prisma.acquisitionLink.update({ where: { id: link.id }, data: { archivedAt: captureNow } })
    expect(await bootstrapAnalyticsSession(context, input, captureNow)).toEqual(first)
    const second = await bootstrapAnalyticsSession(context, { ...input, bootstrapKey: randomUUID() }, captureNow)
    expect(verifyAnalyticsCredential(first.credential, { businessId, origin: context.origin, secret: captureSecret, now: captureNow })?.acquisition.acquisitionLinkId).toBe(link.id)
    expect(verifyAnalyticsCredential(second.credential, { businessId, origin: context.origin, secret: captureSecret, now: captureNow })?.acquisition).toMatchObject({ channel: 'facebook', acquisitionLinkId: null })
  })
  it('POST route boundaries reject malformed/cross-origin input and return no-store bootstrap/batch receipts', async () => {
    const params = { params: Promise.resolve({ slug: businessId }) }
    const req = (kind: string, body: unknown, origin = context.origin) => new Request(`${context.origin}/api/analytics/${businessId}/${kind}`, { method: 'POST', body: JSON.stringify(body), headers: { origin, 'content-type': 'application/json', 'x-forwarded-for': '127.0.0.1' } })
    expect((await sessionPOST(req('session', sessionInput(), 'https://evil.test'), params)).status).toBe(403)
    expect((await sessionPOST(req('session', { ...sessionInput(), consent: false }), params)).status).toBe(400)
    const response = await sessionPOST(req('session', sessionInput()), params)
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    const session = await response.json()
    const attemptResponse = await attemptPOST(req('attempt', { credential: session.credential, bootstrapKey: randomUUID(), entryKind: 'complete' }), params)
    expect(attemptResponse.status).toBe(200)
    const attempt = await attemptResponse.json()
    const events = await eventsPOST(req('events', { credential: attempt.credential, events: [event(1)] }), params)
    expect(events.status).toBe(200)
    expect((await events.json()).receipts[0].status).toBe('accepted')
    execute.mockResolvedValue(0)
    expect((await sessionPOST(req('session', sessionInput()), params)).status).toBe(429)
    expect((await eventsPOST(req('events', { credential: attempt.credential, events: [], captureGap: true }), params)).status).toBe(429)
    expect(await prisma.bookingFunnelAttempt.findUnique({ where: { id: attempt.id } })).toMatchObject({ knownCaptureGap: false })
  })
})
