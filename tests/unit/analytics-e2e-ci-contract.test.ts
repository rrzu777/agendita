// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { basename, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { requireAnalyticsTestDatabase } from '../helpers/analytics-database'

const require = createRequire(import.meta.url)
const { load } = require('js-yaml') as { load: (source: string) => unknown }
type Job = {
  env: Record<string, string>
  services: { postgres: { env: Record<string, string>; ports: string[] } }
  steps: { run?: string }[]
}
const workflow = load(readFileSync('.github/workflows/ci.yml', 'utf8')) as { jobs: Record<string, Job> }
const analyticsSpecs = ['owner-analytics-public.spec.ts', 'owner-analytics.spec.ts']

function listSpecs(config: string, env: Record<string, string>) {
  // Real discovery only: no web server, test hooks, database queries or browsers.
  // Inherit no user/provider credentials or flags enabling real registration.
  const result = spawnSync(process.execPath, [resolve('node_modules/@playwright/test/cli.js'), 'test', `--config=${config}`, '--list', '--reporter=json'], {
    env: { PATH: process.env.PATH, HOME: process.env.HOME, CI: 'true', NODE_ENV: 'test', ...env },
    encoding: 'utf8', timeout: 30_000, maxBuffer: 4 * 1024 * 1024,
  })
  expect(result.error).toBeUndefined()
  expect(result.status, result.stderr || result.stdout).toBe(0)
  const report = JSON.parse(result.stdout) as { suites: { file: string }[]; errors: unknown[] }
  expect(report.errors).toEqual([])
  return report.suites.map((suite) => basename(suite.file)).sort()
}

afterEach(() => vi.unstubAllEnvs())

describe('owner analytics E2E CI routing', () => {
  it('discovers every other E2E in the general production-mode job without importing analytics fixtures', () => {
    const expected = readdirSync('tests/e2e').filter((file) => file.endsWith('.spec.ts') && !analyticsSpecs.includes(file)).sort()
    expect(expected.length).toBeGreaterThan(0)
    expect(listSpecs('playwright.config.ts', workflow.jobs.e2e.env)).toEqual(expected)
  }, 40_000)

  it('provisions the exact exclusive DB accepted by the unchanged analytics guards', () => {
    const job = workflow.jobs['owner-analytics-e2e']
    expect(job).toBeDefined()
    for (const key of ['DATABASE_URL', 'DIRECT_URL', 'NODE_ENV']) vi.stubEnv(key, job.env[key])
    expect(() => requireAnalyticsTestDatabase()).not.toThrow()
    const exactUrl = 'postgresql://analytics:analytics@127.0.0.1:55439/agendita_owner_analytics_test'
    expect(job.env.DATABASE_URL).toBe(exactUrl)
    expect(job.env.DIRECT_URL).toBe(exactUrl)
    expect(job.services.postgres.env).toMatchObject({ POSTGRES_USER: 'analytics', POSTGRES_PASSWORD: 'analytics', POSTGRES_DB: 'agendita_owner_analytics_test' })
    expect(job.services.postgres.ports).toContain('55439:5432')
  })

  it.each([
    ['playwright.owner-analytics-public.config.ts', 'owner-analytics-public.spec.ts'],
    ['playwright.owner-analytics.config.ts', 'owner-analytics.spec.ts'],
  ])('runs %s explicitly after DB/browser setup and discovers only %s', (config, spec) => {
    const job = workflow.jobs['owner-analytics-e2e']
    expect(job).toBeDefined()
    const commands = job.steps.map((step) => step.run)
    const testIndex = commands.indexOf(`npx playwright test --config=${config}`)
    const migrateIndex = commands.indexOf('npx prisma migrate deploy')
    const browserIndex = commands.indexOf('npx playwright install --with-deps chromium')
    expect(migrateIndex).toBeGreaterThanOrEqual(0)
    expect(browserIndex).toBeGreaterThanOrEqual(0)
    expect(testIndex).toBeGreaterThan(Math.max(migrateIndex, browserIndex))
    expect(listSpecs(config, job.env)).toEqual([spec])
  }, 40_000)
})
