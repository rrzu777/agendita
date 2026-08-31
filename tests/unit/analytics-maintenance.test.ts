// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runOwnerAnalyticsMaintenance } from '@/server/analytics/maintenance'
const query = vi.hoisted(() => vi.fn())
vi.mock('@/lib/db', () => ({ prisma: { $queryRaw: query } }))
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); query.mockReset() })
describe('maintenance input boundaries before database access', () => {
  it.each([0, -1, 1.5, NaN])('rejects invalid maxRows %s', async maxRows => {
    await expect(runOwnerAnalyticsMaintenance({ maxRows })).rejects.toThrow('budget')
    expect(query).not.toHaveBeenCalled()
  })
  it.each(['{}', 'x'.repeat(1025), Buffer.from(JSON.stringify({ businessId: 'foreign', definitionVersion: 1, localDate: '2026-08-01', timezone: 'UTC', extra: true })).toString('base64url')])('rejects malformed continuation', async cursor => {
    await expect(runOwnerAnalyticsMaintenance({ cursor })).rejects.toThrow('cursor')
    expect(query).not.toHaveBeenCalled()
  })
  it('yields a resumable cursor when the server invocation time budget is exhausted', async () => {
    vi.stubEnv('OWNER_ANALYTICS_ENABLED', 'true')
    query.mockResolvedValue([])
    vi.spyOn(performance, 'now').mockReturnValueOnce(0).mockReturnValue(45000)
    expect(await runOwnerAnalyticsMaintenance()).toMatchObject({ errors: 0, hasMore: true, nextCursor: 'cleanup:v1', deleted: 0 })
  })
})
