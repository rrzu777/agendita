// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const findBusinesses = vi.hoisted(() => vi.fn())
const findMetrics = vi.hoisted(() => vi.fn())
vi.mock('@/lib/db', () => ({ prisma: { business: { findMany: findBusinesses }, analyticsDailyMetric: { findMany: findMetrics } } }))

import { selectWeeklyInsightCandidates } from '@/server/analytics/weekly-insights/selector'

function markers(start: string) {
  const result: Record<string, unknown>[] = []
  const base = new Date(`${start}T00:00:00.000Z`)
  for (let offset = 0; offset < 7; offset += 1) for (const population of ['sessions', 'complete_attempts', 'partial_attempts']) result.push({ id: `${offset}-${population}`, cohortLocalDate: new Date(base.getTime() + offset * 86400000), businessTimeZone: 'America/Santiago', definitionVersion: 1, consentVersion: 1, revision: 1, retentionExpiresAt: new Date('2026-11-30T00:00:00Z') })
  return result
}

describe('weekly selector', () => {
  beforeEach(() => { vi.stubEnv('OWNER_ANALYTICS_INSIGHTS_ENABLED', 'true'); vi.stubEnv('OWNER_ANALYTICS_INSIGHTS_PRIVACY_APPROVED', 'true'); vi.stubEnv('OWNER_ANALYTICS_INSIGHTS_BUSINESS_IDS', 'biz-a'); vi.stubEnv('OWNER_ANALYTICS_INSIGHTS_WEEKLY_CALL_BUDGET', '10'); vi.stubEnv('OWNER_ANALYTICS_INSIGHTS_WEEKLY_TOKEN_BUDGET', '7000'); findBusinesses.mockResolvedValue([{ id: 'biz-a', timezone: 'America/Santiago' }]); findMetrics.mockResolvedValue(markers('2026-08-24')) })
  afterEach(() => { vi.clearAllMocks(); vi.unstubAllEnvs() })

  it('waits until Wednesday 09:00 in the business timezone and returns a closed week', async () => {
    expect((await selectWeeklyInsightCandidates({ now: new Date('2026-09-02T11:59:00.000Z'), cursor: null, limit: 20 })).candidates).toHaveLength(0)
    const result = await selectWeeklyInsightCandidates({ now: new Date('2026-09-02T13:00:00.000Z'), cursor: null, limit: 20 })
    expect(result.candidates[0]).toMatchObject({ businessId: 'biz-a', sourceConsentVersion: 1 })
    expect(result.candidates[0].weekStart.toISOString().slice(0, 10)).toBe('2026-08-24')
  })

  it('rejects a mixed-consent or incomplete week instead of publishing zeros', async () => {
    findMetrics.mockResolvedValue(markers('2026-08-24').slice(0, 20))
    const result = await selectWeeklyInsightCandidates({ now: new Date('2026-09-02T13:00:00.000Z'), cursor: null, limit: 20 })
    expect(result.candidates).toHaveLength(0)
  })
})
