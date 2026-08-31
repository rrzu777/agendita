// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AnalyticsCaptureError, handleAnalyticsPost, type CaptureErrorCategory } from '@/lib/analytics/ingest'
import * as operational from '@/lib/metrics/operational'
import { configureCapture, captureSecret, liveCaptureClaims } from '../helpers/analytics-capture'
import { signAnalyticsCredential } from '@/lib/analytics/credential'

const context = vi.hoisted(() => vi.fn())
const execute = vi.hoisted(() => vi.fn())
const db = vi.hoisted(() => ({ $transaction: vi.fn(), $executeRaw: vi.fn(), analyticsCollectionPeriod: { findFirst: vi.fn() }, analyticsSession: { findUnique: vi.fn(), findFirst: vi.fn() }, bookingFunnelAttempt: { findUnique: vi.fn() } }))
vi.mock('@/lib/analytics/public-context', () => ({ resolvePublicAnalyticsContext: context }))
vi.mock('@/lib/upstash-rest', () => ({ executeUpstashCommand: execute }))
vi.mock('@/lib/db', () => ({ prisma: db }))

const origin = 'https://collector-fixture.agendita.test'
const slug = 'collector-fixture'
const bootstrapKey = '89a16850-9b5d-4ed8-b36d-7365b4342a48'
const bootstrap = { bootstrapKey, consent: true, consentVersion: 1 }
const request = (body: unknown) => new Request(`${origin}/api/analytics/${slug}/events`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '192.0.2.87' }, body: JSON.stringify(body) })
let before: Map<string, number>
function samples() {
  return operational.getOperationalMetricsSnapshot().samples.flatMap(sample => {
    const count = sample.count - (before.get(`${sample.operation}:${sample.outcome}`) ?? 0)
    return count ? [{ ...sample, count }] : []
  })
}
function expectTerminal(kind: string, category: string, outcome: 'success' | 'user_error' | 'error') {
  expect(samples()).toEqual([{ operation: `analytics_collector_${kind}_${category}`, outcome, count: 1, durationMs: expect.any(Number) }])
  expect(samples()[0].durationMs).toBeGreaterThanOrEqual(0)
}

describe('collector HTTP counters use the real per-instance operational snapshot', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    configureCapture()
    context.mockResolvedValue({ businessId: 'biz-a', slug, origin, timezone: 'America/Santiago' })
    execute.mockResolvedValue(1)
    db.$transaction.mockImplementation(async work => work(db))
    db.analyticsCollectionPeriod.findFirst.mockResolvedValue({ id: 'synthetic-period' })
    const claims = liveCaptureClaims('biz-a', origin)
    const session = { id: claims.sessionId, businessId: claims.businessId, bootstrapKey, origin, consentVersion: 1, definitionVersion: 1, startedAt: new Date(claims.sessionStartedAt), expiresAt: new Date(claims.sessionExpiresAt), retentionExpiresAt: new Date(claims.retentionExpiresAt), channel: 'instagram', normalizationVersion: 1, acquisitionLinkId: null, businessTimeZone: 'America/Santiago', cohortLocalDate: new Date('2026-08-31'), acceptedEventCount: 0, knownCaptureGap: false }
    db.analyticsSession.findUnique.mockResolvedValue(session)
    db.analyticsSession.findFirst.mockResolvedValue(session)
    before = new Map(operational.getOperationalMetricsSnapshot().samples.map(sample => [`${sample.operation}:${sample.outcome}`, sample.count]))
  })
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs() })

  it('counts successful bootstrap retries as two requests, never two new identities', async () => {
    const first = await handleAnalyticsPost(request(bootstrap), slug, 'session')
    const second = await handleAnalyticsPost(request(bootstrap), slug, 'session')
    expect(first.status).toBe(200)
    expect(first.headers.get('cache-control')).toBe('no-store')
    expect(await first.json()).toEqual(await second.json())
    expect(samples()).toEqual([{ operation: 'analytics_collector_session_success', outcome: 'success', count: 2, durationMs: expect.any(Number) }])
  })

  it.each(['session', 'attempt', 'events'] as const)('counts early disabled context once for %s before credential checks', async kind => {
    context.mockResolvedValue(null)
    const response = await handleAnalyticsPost(request({ credential: 'private-invalid-token', events: [{}] }), slug, kind)
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ category: 'disabled' })
    expect(response.headers.get('cache-control')).toBe('no-store')
    expectTerminal(kind, 'disabled_context', 'user_error')
  })

  it('keeps malformed body validation ahead of context denial', async () => {
    context.mockResolvedValue(null)
    const response = await handleAnalyticsPost(new Request(origin, { method: 'POST', body: '{', headers: { 'content-type': 'application/json' } }), slug, 'events')
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ category: 'invalid_request' })
    expectTerminal('events', 'invalid_request', 'user_error')
  })

  it('counts invalid credentials without storing the submitted token', async () => {
    const response = await handleAnalyticsPost(request({ credential: 'private-invalid-token', events: [{}] }), slug, 'events')
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ category: 'invalid_credential' })
    expectTerminal('events', 'invalid_credential', 'user_error')
  })

  it('counts actual distributed rate-limit denial without an event receipt', async () => {
    execute.mockResolvedValue(0)
    const credential = signAnalyticsCredential(liveCaptureClaims('biz-a', origin), captureSecret)
    const response = await handleAnalyticsPost(request({ credential, events: [], captureGap: true }), slug, 'events')
    expect(response.status).toBe(429)
    expect(await response.json()).toEqual({ category: 'rate_limit' })
    expectTerminal('events', 'rate_limit', 'user_error')
    expect(JSON.stringify(samples())).not.toContain(credential)
  })

  it('measures request duration with monotonic elapsed time, not client timestamps', async () => {
    const priorDuration = operational.getOperationalMetricsSnapshot().samples.find(sample => sample.operation === 'analytics_collector_attempt_invalid_request')?.durationMs ?? 0
    vi.spyOn(performance, 'now').mockReturnValueOnce(500).mockReturnValueOnce(525)
    const response = await handleAnalyticsPost(request({ startedAt: '1900-01-01T00:00:00Z' }), slug, 'attempt')
    expect(response.status).toBe(400)
    expectTerminal('attempt', 'invalid_request', 'user_error')
    expect(samples()[0].durationMs - priorDuration).toBe(25)
  })

  it.each(['private-category', 'constructor', '__proto__'])('does not turn an unexpected runtime category %s into a metric label', async category => {
    db.$transaction.mockRejectedValue(new AnalyticsCaptureError(category as CaptureErrorCategory))
    const response = await handleAnalyticsPost(request(bootstrap), slug, 'session')
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ category }) // Existing HTTP contract is unchanged.
    expectTerminal('session', 'unavailable', 'error')
  })

  it.each([
    ['invalid_request', 400, 'user_error'], ['invalid_credential', 403, 'user_error'], ['disabled', 403, 'user_error'], ['expired', 409, 'user_error'], ['conflict', 409, 'user_error'], ['rate_limit', 429, 'user_error'], ['budget', 429, 'user_error'], ['unavailable', 503, 'error'],
  ] as const)('retains the HTTP contract and finite counter for capture error %s', async (category, status, outcome) => {
    db.$transaction.mockRejectedValue(new AnalyticsCaptureError(category satisfies CaptureErrorCategory))
    const response = await handleAnalyticsPost(request(bootstrap), slug, 'session')
    expect(response.status).toBe(status)
    expect(await response.json()).toEqual({ category })
    expect(response.headers.get('cache-control')).toBe('no-store')
    expectTerminal('session', category, outcome)
  })

  it('normalizes unexpected failures and never labels with identifiers, URLs, IP, event type or error text', async () => {
    const detail = 'private-database-error'
    db.$transaction.mockRejectedValue(new Error(detail))
    const response = await handleAnalyticsPost(request(bootstrap), slug, 'session')
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ category: 'unavailable' })
    expectTerminal('session', 'unavailable', 'error')
    const serialized = JSON.stringify(operational.getOperationalMetricsSnapshot().samples)
    for (const forbidden of [detail, slug, origin, 'biz-a', bootstrapKey, 'private-invalid-token', '192.0.2.87', 'service_considered']) expect(serialized).not.toContain(forbidden)
    for (const sample of operational.getOperationalMetricsSnapshot().samples) expect(sample.operation).toMatch(/^[a-z][a-z0-9_]{0,63}$/)
  })

  it('contains metric-sink exceptions without changing a successful bootstrap or failed response', async () => {
    vi.spyOn(operational, 'recordOperationalMetric').mockImplementation(() => { throw new Error('synthetic metric sink unavailable') })
    const response = await handleAnalyticsPost(request(bootstrap), slug, 'session')
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.json()).toMatchObject({ id: liveCaptureClaims().sessionId, credential: expect.any(String) })
    const rejected = await handleAnalyticsPost(request({ bootstrapKey: randomUUID(), consent: false }), slug, 'session')
    expect(rejected.status).toBe(400)
    expect(await rejected.json()).toEqual({ category: 'invalid_request' })
  })
})
