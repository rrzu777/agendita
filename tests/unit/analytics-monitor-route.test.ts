// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const evaluate = vi.hoisted(() => vi.fn())
const drain = vi.hoisted(() => vi.fn())
const findHeartbeat = vi.hoisted(() => vi.fn())

vi.mock('@/server/analytics/operations/incidents', () => ({ evaluateOwnerAnalyticsOperations: evaluate }))
vi.mock('@/server/analytics/operations/email-outbox', () => ({ drainAnalyticsEmailOutbox: drain, OPERATIONAL_NOTIFICATION_KINDS: ['alert_open', 'alert_escalation', 'alert_reminder', 'alert_beyond_tolerance', 'alert_resolved'] }))
vi.mock('@/lib/db', () => ({ prisma: { analyticsJobHeartbeat: { findUnique: findHeartbeat } } }))

import { POST } from '@/app/api/cron/owner-analytics-monitor/route'

const request = (init: RequestInit = {}, suffix = '') => new Request(`https://analytics.invalid/api/cron/owner-analytics-monitor${suffix}`, {
  ...init,
  method: 'POST',
  headers: { authorization: 'Bearer synthetic-cron-secret', ...(init.headers ?? {}) },
})

describe('owner analytics monitor route', () => {
  beforeEach(() => {
    vi.stubEnv('CRON_SECRET', 'synthetic-cron-secret')
    vi.stubEnv('OWNER_ANALYTICS_OPERATIONAL_MONITOR_ENABLED', 'false')
    vi.stubEnv('OWNER_ANALYTICS_ALERTS_ENABLED', 'false')
    vi.stubEnv('OWNER_ANALYTICS_ALERT_EMAILS', '')
    evaluate.mockReset()
    drain.mockReset()
    findHeartbeat.mockReset()
    evaluate.mockResolvedValue({ state: 'not_enabled', incidents: [], backlog: { overdueMs: 0, dangerous: false, beyondTolerance: false, hasExpired: false } })
    drain.mockResolvedValue({ sent: 0, failed: 0, pending: 0 })
    findHeartbeat.mockResolvedValue(null)
  })
  afterEach(() => vi.unstubAllEnvs())

  it('requires exact bearer authentication and rejects query/body input', async () => {
    expect((await POST(new Request('https://analytics.invalid/api/cron/owner-analytics-monitor', { method: 'POST' }))).status).toBe(401)
    expect((await POST(request({}, '?unexpected=1'))).status).toBe(400)
    expect((await POST(request({ body: JSON.stringify({ cursor: 'x' }), headers: { 'content-type': 'application/json' } }))).status).toBe(400)
    expect(evaluate).not.toHaveBeenCalled()
  })

  it('returns disabled state without querying heartbeat or outbox', async () => {
    const response = await POST(request())
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.json()).toMatchObject({ state: 'not_enabled', heartbeat: null, deliveries: { sent: 0, failed: 0, pending: 0 } })
    expect(findHeartbeat).not.toHaveBeenCalled()
    expect(drain).not.toHaveBeenCalled()
  })

  it('suspends email delivery while operations are unhealthy', async () => {
    vi.stubEnv('OWNER_ANALYTICS_OPERATIONAL_MONITOR_ENABLED', 'true')
    vi.stubEnv('OWNER_ANALYTICS_ALERTS_ENABLED', 'true')
    vi.stubEnv('OWNER_ANALYTICS_ALERT_EMAILS', 'ops@example.com')
    evaluate.mockResolvedValue({ state: 'critical', incidents: [{ incidentType: 'heartbeat_stale', severity: 'critical', details: { staleMs: 14400000 }, beyondTolerance: false }], backlog: { overdueMs: 0, dangerous: false, beyondTolerance: false, hasExpired: false } })
    findHeartbeat.mockResolvedValue({ lastStatus: 'failed', lastStartedAt: new Date('2026-09-05T00:00:00.000Z'), lastCompletedAt: null, lastSuccessAt: null, lastProgressAt: null, consecutiveFailures: 4, consecutiveSuccesses: 0, runErrors: 2, nextBatchSequence: 3 })
    const response = await POST(request())
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ state: 'critical', heartbeat: { consecutiveFailures: 4 }, deliveries: { sent: 0, failed: 0, pending: 0 } })
    expect(findHeartbeat).toHaveBeenCalledWith(expect.objectContaining({ where: { jobKey: 'owner_analytics_maintenance' } }))
    expect(drain).toHaveBeenCalledWith({ maxDeliveries: 10, notificationKinds: ['alert_open', 'alert_escalation', 'alert_reminder', 'alert_beyond_tolerance', 'alert_resolved'] })
  })

  it('drains a bounded outbox when operations are healthy', async () => {
    vi.stubEnv('OWNER_ANALYTICS_OPERATIONAL_MONITOR_ENABLED', 'true')
    vi.stubEnv('OWNER_ANALYTICS_ALERTS_ENABLED', 'true')
    vi.stubEnv('OWNER_ANALYTICS_ALERT_EMAILS', 'ops@example.com')
    evaluate.mockResolvedValue({ state: 'healthy', incidents: [], backlog: { overdueMs: 0, dangerous: false, beyondTolerance: false, hasExpired: false } })
    findHeartbeat.mockResolvedValue({ lastStatus: 'succeeded', lastStartedAt: new Date('2026-09-05T11:00:00.000Z'), lastCompletedAt: new Date('2026-09-05T11:01:00.000Z'), lastSuccessAt: new Date('2026-09-05T11:01:00.000Z'), lastProgressAt: new Date('2026-09-05T11:01:00.000Z'), consecutiveFailures: 0, consecutiveSuccesses: 2, runErrors: 0, nextBatchSequence: null })
    drain.mockResolvedValue({ sent: 1, failed: 0, pending: 0 })
    const response = await POST(request())
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ state: 'healthy', deliveries: { sent: 1 } })
    expect(drain).toHaveBeenCalledWith({ maxDeliveries: 10 })
  })

  it('does not drain an outbox before the monitor has initialized', async () => {
    vi.stubEnv('OWNER_ANALYTICS_OPERATIONAL_MONITOR_ENABLED', 'true')
    vi.stubEnv('OWNER_ANALYTICS_ALERTS_ENABLED', 'true')
    vi.stubEnv('OWNER_ANALYTICS_ALERT_EMAILS', 'ops@example.com')
    evaluate.mockResolvedValue({ state: 'not_initialized', incidents: [], backlog: { overdueMs: 0, dangerous: false, beyondTolerance: false, hasExpired: false } })
    const response = await POST(request())
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ state: 'not_initialized', deliveries: { sent: 0, failed: 0, pending: 0 } })
    expect(drain).not.toHaveBeenCalled()
  })
})
