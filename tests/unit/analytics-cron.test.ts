// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { POST } from '@/app/api/cron/owner-analytics/route'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
const maintenance = vi.hoisted(() => vi.fn())
vi.mock('@/server/analytics/maintenance', () => ({ runOwnerAnalyticsMaintenance: maintenance }))
describe('separate authenticated analytics cron', () => {
  beforeEach(() => { vi.stubEnv('CRON_SECRET', 'synthetic-cron-secret'); maintenance.mockReset() })
  afterEach(() => vi.unstubAllEnvs())
  it('fails closed without exact bearer authentication', async () => {
    for (const authorization of ['', 'Bearer wrong']) expect((await POST(new Request('https://analytics.invalid/api/cron/owner-analytics', { method: 'POST', headers: { authorization } }))).status).toBe(401)
    vi.stubEnv('CRON_SECRET', '')
    expect((await POST(new Request('https://analytics.invalid', { method: 'POST' }))).status).toBe(401)
    expect(maintenance).not.toHaveBeenCalled()
  })
  it('passes bounded continuation and returns explicit failures instead of errors zero', async () => {
    const req = () => new Request('https://analytics.invalid/api/cron/owner-analytics?cursor=cleanup%3Av1', { method: 'POST', headers: { authorization: 'Bearer synthetic-cron-secret' } })
    maintenance.mockResolvedValue({ errors: 0, deleted: 10000, published: 0, hasMore: true, nextCursor: 'cleanup:v1' })
    expect(await (await POST(req())).json()).toMatchObject({ hasMore: true, deleted: 10000, nextCursor: 'cleanup:v1' })
    expect(maintenance).toHaveBeenCalledWith({ cursor: 'cleanup:v1' })
    maintenance.mockRejectedValue(new Error('private-database-details'))
    const response = await POST(req())
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ errors: 1, error: 'maintenance_failed' })
  })
})

describe('bounded continuation shell driver with no network', () => {
  function run(responses: unknown[]) {
    const dir = mkdtempSync(join(tmpdir(), 'analytics-cron-test-'))
    try {
      writeFileSync(join(dir, 'responses.json'), JSON.stringify(responses))
      writeFileSync(join(dir, 'curl'), `#!/usr/bin/env node\nconst fs=require('fs');const p=process.env.FIXTURE_DIR;const n=fs.existsSync(p+'/count')?Number(fs.readFileSync(p+'/count')):0;fs.writeFileSync(p+'/count',String(n+1));const rows=JSON.parse(fs.readFileSync(p+'/responses.json'));process.stdout.write(JSON.stringify(rows[Math.min(n,rows.length-1)]));`, { mode: 0o700 })
      return spawnSync('bash', ['scripts/run-owner-analytics-cron.sh'], { encoding: 'utf8', env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, FIXTURE_DIR: dir, OWNER_ANALYTICS_CRON_URL: 'https://analytics.invalid/api/cron/owner-analytics', CRON_SECRET: 'synthetic-only', OWNER_ANALYTICS_CRON_MAX_REQUESTS: '3' } })
    } finally { rmSync(dir, { recursive: true, force: true }) }
  }
  it('continues until drained but fails if dangerous backlog remains beyond request budget', () => {
    const more = { errors: 0, hasMore: true, nextCursor: 'cleanup:v1', backlog: { dangerous: true } }
    expect(run([more, { errors: 0, hasMore: false, nextCursor: null }]).status).toBe(0)
    expect(run([more]).status).toBe(1)
    expect(run([{ errors: 1, hasMore: false }]).status).toBe(1)
    expect(run([{ hasMore: false }]).status).toBe(1)
  })
})
