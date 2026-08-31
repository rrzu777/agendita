// @vitest-environment node
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { requireAnalyticsTestDatabase } from '../helpers/analytics-database'

const require = createRequire(import.meta.url)
const { load } = require('js-yaml') as { load: (source: string) => unknown }
type Step = { id?: string; run?: string }
type IntegrationJob = {
  env: Record<string, string>
  services: { postgres: { env: Record<string, string> } }
  steps: Step[]
}
const workflow = load(readFileSync('.github/workflows/ci.yml', 'utf8')) as {
  jobs: { integration: IntegrationJob }
}
const integration = workflow.jobs.integration
const validUrl = 'postgresql://analytics:analytics@127.0.0.1:55439/agendita_owner_analytics_test'

afterEach(() => vi.unstubAllEnvs())

describe('analytics CI integration contract', () => {
  it('provisions the same disposable database used by BOTH URLs, accepted by the unchanged guard', () => {
    for (const key of ['DATABASE_URL', 'DIRECT_URL', 'NODE_ENV']) vi.stubEnv(key, integration.env[key])
    expect(() => requireAnalyticsTestDatabase()).not.toThrow()
    const service = integration.services.postgres.env
    for (const key of ['DATABASE_URL', 'DIRECT_URL']) {
      const url = new URL(integration.env[key])
      expect(url.pathname).toBe(`/${service.POSTGRES_DB}`)
      expect(url.username).toBe(service.POSTGRES_USER)
      expect(url.password).toBe(service.POSTGRES_PASSWORD)
    }
    expect(new URL(integration.env.DIRECT_URL).host).toBe(new URL(integration.env.DATABASE_URL).host)
  })

  it('explicitly provisions and verifies both Redis tools before running the complete integration suite', () => {
    const setupIndex = integration.steps.findIndex((step) => step.id === 'redis-tools')
    const testIndex = integration.steps.findIndex((step) => step.run?.trim() === 'npm run test:integration')
    expect(setupIndex).toBeGreaterThanOrEqual(0)
    expect(testIndex).toBeGreaterThan(setupIndex)
    const setup = integration.steps[setupIndex]
    expect(setup.run).toBeTruthy()

    // Execute the actual workflow shell while replacing only external package provisioning.
    // These stubs emulate an initially bare runner: tools fail until the right packages were installed.
    const harness = `
installed_server=0
installed_cli=0
sudo() {
  test "$1" = apt-get || return 64
  shift
  case "$1" in
    update) return 0 ;;
    install)
      shift
      for package in "$@"; do
        case "$package" in
          redis-server) installed_server=1 ;;
          redis-tools) installed_cli=1 ;;
        esac
      done ;;
    *) return 64 ;;
  esac
}
redis-server() { test "$installed_server" = 1 && test "$1" = --version && printf 'server verified\\n'; }
redis-cli() { test "$installed_cli" = 1 && test "$1" = --version && printf 'cli verified\\n'; }
`
    const result = spawnSync('bash', ['-e', '-c', `${harness}\n${setup.run}`], { encoding: 'utf8' })
    expect(result.status).toBe(0)
    expect(result.stderr).toBe('')
    expect(result.stdout.trim().split('\n')).toEqual(['server verified', 'cli verified'])
  })
})

describe('unchanged exclusive analytics database guard', () => {
  beforeEach(() => {
    vi.stubEnv('DATABASE_URL', validUrl)
    vi.stubEnv('DIRECT_URL', validUrl)
    vi.stubEnv('NODE_ENV', 'test')
  })

  it.each(['127.0.0.1', 'localhost', '[::1]'])('accepts explicitly configured exclusive database on loopback %s', (host) => {
    for (const key of ['DATABASE_URL', 'DIRECT_URL']) vi.stubEnv(key, `postgresql://analytics:analytics@${host}:55439/agendita_owner_analytics_test`)
    expect(() => requireAnalyticsTestDatabase()).not.toThrow()
  })

  it.each(['DATABASE_URL', 'DIRECT_URL'])('refuses missing %s even when the other URL is safe', (key) => {
    vi.stubEnv(key, undefined)
    expect(() => requireAnalyticsTestDatabase()).toThrow()
  })

  it.each([
    ['DATABASE_URL', 'postgresql://analytics:analytics@db.example.test:5432/agendita_owner_analytics_test'],
    ['DIRECT_URL', 'postgresql://analytics:analytics@db.example.test:5432/agendita_owner_analytics_test'],
    ['DATABASE_URL', 'postgresql://analytics:analytics@localhost:5432/agendita_test'],
    ['DIRECT_URL', 'postgresql://analytics:analytics@localhost:5432/agendita_test'],
    ['DIRECT_URL', 'postgresql://analytics:analytics@localhost:5432/agendita_owner_analytics_test_extra'],
    ['DATABASE_URL', 'not-a-url'],
  ])('refuses unsafe %s independently: %s', (key, value) => {
    vi.stubEnv(key, value)
    expect(() => requireAnalyticsTestDatabase()).toThrow()
  })

  it('refuses production mode even with both exclusive loopback URLs', () => {
    vi.stubEnv('NODE_ENV', 'production')
    expect(() => requireAnalyticsTestDatabase()).toThrow()
  })
})
