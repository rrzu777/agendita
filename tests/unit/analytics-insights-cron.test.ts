// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const job = vi.hoisted(() => vi.fn())
vi.mock('@/server/analytics/weekly-insights/job', () => ({ runWeeklyInsightsJob: job }))

import { POST } from '@/app/api/cron/owner-analytics-insights/route'

const request = (init: RequestInit = {}, suffix = '') => new Request(`https://analytics.invalid/api/cron/owner-analytics-insights${suffix}`, { ...init, method: 'POST', headers: { authorization: 'Bearer synthetic-cron-secret', ...(init.headers ?? {}) } })

describe('weekly insights cron route', () => {
  beforeEach(() => { vi.stubEnv('CRON_SECRET', 'synthetic-cron-secret'); job.mockReset(); job.mockResolvedValue({ processed: 1, nextCursor: null }) })
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
    expect(await response.json()).toEqual({ processed: 1, nextCursor: null })
  })
})
