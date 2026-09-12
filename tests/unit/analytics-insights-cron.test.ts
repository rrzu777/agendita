// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const job = vi.hoisted(() => vi.fn())
const heartbeat = vi.hoisted(() => ({
  start: vi.fn(async () => ({ jobKey: 'weekly_insights', runId: '11111111-1111-4111-8111-111111111111', leaseToken: '22222222-2222-4222-8222-222222222222', batchSequence: 1, resumeCursor: null })),
  progress: vi.fn(async () => undefined),
  finish: vi.fn(async () => true),
}))
vi.mock('@/server/analytics/weekly-insights/job', () => ({ runWeeklyInsightsJob: job }))
vi.mock('@/server/analytics/operations/heartbeat', () => ({
  ANALYTICS_WEEKLY_INSIGHTS_JOB: 'weekly_insights',
  startAnalyticsJobRun: heartbeat.start,
  recordAnalyticsJobProgress: heartbeat.progress,
  finishAnalyticsJobRun: heartbeat.finish,
  isUuid: (value: unknown) => typeof value === 'string' && /^[0-9a-f-]{36}$/i.test(value),
}))

import { POST } from '@/app/api/cron/owner-analytics-insights/route'

const request = (init: RequestInit = {}, suffix = '') => new Request(`https://analytics.invalid/api/cron/owner-analytics-insights${suffix}`, { ...init, method: 'POST', headers: { authorization: 'Bearer synthetic-cron-secret', ...(init.headers ?? {}) } })

describe('weekly insights cron route', () => {
  beforeEach(() => { vi.stubEnv('CRON_SECRET', 'synthetic-cron-secret'); job.mockReset(); job.mockResolvedValue({ processed: 1, nextCursor: null }); heartbeat.start.mockClear(); heartbeat.progress.mockClear(); heartbeat.finish.mockClear() })
  afterEach(() => vi.unstubAllEnvs())

  it('rejects wrong auth, unexpected query and body', async () => {
    expect((await POST(new Request('https://analytics.invalid/api/cron/owner-analytics-insights', { method: 'POST' }))).status).toBe(401)
    expect((await POST(request({}, '?unexpected=x'))).status).toBe(400)
    expect((await POST(request({ body: 'x' }))).status).toBe(400)
    expect(job).not.toHaveBeenCalled()
  })

  it('passes the opaque cursor and returns no-store', async () => {
    const response = await POST(request({}, '?cursor=opaque'))
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(job).toHaveBeenCalledWith({ now: expect.any(Date), cursor: 'opaque' })
    expect(await response.json()).toMatchObject({ processed: 1, nextCursor: null, runId: expect.any(String), leaseToken: expect.any(String), nextBatchSequence: 2, heartbeatFinished: true })
    expect(heartbeat.progress).toHaveBeenCalledWith(expect.objectContaining({ jobKey: 'weekly_insights', batchSequence: 1, hasMore: false, nextCursor: null }))
    expect(heartbeat.finish).toHaveBeenCalledWith(expect.objectContaining({ jobKey: 'weekly_insights', status: 'succeeded' }))
  })

  it('continues an active fenced run with its next sequence', async () => {
    job.mockResolvedValueOnce({ processed: 1, nextCursor: 'next' })
    const response = await POST(request({ headers: { 'x-analytics-run-id': '11111111-1111-4111-8111-111111111111', 'x-analytics-lease-token': '22222222-2222-4222-8222-222222222222', 'x-analytics-batch-sequence': '4' } }, '?cursor=opaque'))
    expect(response.status).toBe(200)
    expect(job).toHaveBeenCalledWith({ now: expect.any(Date), cursor: 'opaque' })
    expect(heartbeat.start).not.toHaveBeenCalled()
    expect(heartbeat.progress).toHaveBeenCalledWith(expect.objectContaining({ runId: '11111111-1111-4111-8111-111111111111', leaseToken: '22222222-2222-4222-8222-222222222222', batchSequence: 4, hasMore: true, nextCursor: 'next' }))
    expect(heartbeat.finish).not.toHaveBeenCalled()
  })

  it('fails closed when the terminal heartbeat fence is lost', async () => {
    heartbeat.finish.mockResolvedValueOnce(false)
    const response = await POST(request())
    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: 'stale_run' })
  })
})
