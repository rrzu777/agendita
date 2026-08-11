import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'

const ROOT = process.cwd()
const RUNNER = join(ROOT, 'scripts/run-payment-qa.cjs')
const temporaryDirectories = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function fakeNpmEnvironment(extraEnv = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'agendita-payment-qa-'))
  temporaryDirectories.push(directory)
  const output = join(directory, 'child.json')
  const executable = join(directory, 'npm')
  writeFileSync(executable, `#!/usr/bin/env node\nrequire('node:fs').writeFileSync(${JSON.stringify(output)}, JSON.stringify({ env: process.env, args: process.argv.slice(2) }))\n`)
  chmodSync(executable, 0o755)
  return {
    output,
    env: { ...process.env, PATH: `${directory}${delimiter}${process.env.PATH}`, ...extraEnv },
  }
}

function run(args, env) {
  return spawnSync(process.execPath, [RUNNER, ...args], { cwd: ROOT, env, encoding: 'utf8' })
}

describe('payment QA runner safety boundary', () => {
  it.each([
    ['missing opt-in', { NODE_ENV: 'development', TEST_DATABASE_URL: 'postgresql://postgres:test@127.0.0.1:5432/agendita_payment_qa_test' }],
    ['remote host', { NODE_ENV: 'test', TEST_DATABASE_URL: 'postgresql://postgres:test@db.example.com:5432/agendita_payment_qa_test' }],
    ['production-looking database', { NODE_ENV: 'test', TEST_DATABASE_URL: 'postgresql://postgres:test@127.0.0.1:5432/agendita' }],
    ['query parameters', { NODE_ENV: 'test', TEST_DATABASE_URL: 'postgresql://postgres:test@127.0.0.1:5432/agendita_payment_qa_test?schema=public' }],
    ['missing password', { NODE_ENV: 'test', TEST_DATABASE_URL: 'postgresql://postgres@127.0.0.1:5432/agendita_payment_qa_test' }],
  ])('rejects %s before spawning a child', (_name, overrides) => {
    const fake = fakeNpmEnvironment({
      ...overrides,
      DATABASE_URL: overrides.TEST_DATABASE_URL,
      DIRECT_URL: overrides.TEST_DATABASE_URL,
    })
    const result = run(['--postgres'], fake.env)
    expect(result.status).not.toBe(0)
    expect(() => readFileSync(fake.output)).toThrow()
  })

  it('rejects parent database URL mismatches before spawning a child', () => {
    const safe = 'postgresql://postgres:test@127.0.0.1:5432/agendita_payment_qa_test'
    const fake = fakeNpmEnvironment({
      NODE_ENV: 'test', TEST_DATABASE_URL: safe, DATABASE_URL: safe,
      DIRECT_URL: 'postgresql://postgres:test@127.0.0.1:5432/other',
    })
    const result = run(['--postgres'], fake.env)
    expect(result.status).not.toBe(0)
    expect(() => readFileSync(fake.output)).toThrow()
  })

  it('sanitizes provider credentials and injects the offline network guard', () => {
    const fake = fakeNpmEnvironment({
      MERCADO_PAGO_ACCESS_TOKEN: 'sentinel', MERCADO_PAGO_CLIENT_SECRET: 'sentinel',
      RESEND_API_KEY: 'sentinel', FROM_EMAIL: 'sentinel@example.com', PAYMENT_PROVIDER: 'mercado_pago',
      MP_SUBSCRIPTIONS_ENABLED: 'true',
      NODE_OPTIONS: '--no-warnings', NODE_PATH: '/tmp/evil', BUN_OPTIONS: '--preload=/tmp/evil.js',
      VITEST_POOL_ID: 'sentinel', NPM_CONFIG_REGISTRY: 'https://example.invalid',
      ENCRYPTION_KEY: 'sentinel', CRON_SECRET: 'sentinel', SUPABASE_SERVICE_ROLE_KEY: 'sentinel',
      UPSTASH_REDIS_REST_TOKEN: 'sentinel', R2_SECRET_ACCESS_KEY: 'sentinel', AWS_SECRET_ACCESS_KEY: 'sentinel',
      VERCEL_OIDC_TOKEN: 'sentinel', UNRELATED_SECRET: 'sentinel',
    })
    const result = run([], fake.env)
    expect(result.status).toBe(0)
    const child = JSON.parse(readFileSync(fake.output, 'utf8'))
    expect(child.env.PAYMENT_QA_OFFLINE).toBe('1')
    expect(child.env.MERCADO_PAGO_ACCESS_TOKEN).toBeUndefined()
    expect(child.env.MERCADO_PAGO_CLIENT_SECRET).toBeUndefined()
    expect(child.env.RESEND_API_KEY).toBeUndefined()
    expect(child.env.FROM_EMAIL).toBeUndefined()
    expect(child.env.PAYMENT_PROVIDER).toBeUndefined()
    expect(child.env.MP_SUBSCRIPTIONS_ENABLED).toBeUndefined()
    for (const key of [
      'NODE_OPTIONS', 'NODE_PATH', 'BUN_OPTIONS', 'VITEST_POOL_ID', 'NPM_CONFIG_REGISTRY',
      'ENCRYPTION_KEY', 'CRON_SECRET', 'SUPABASE_SERVICE_ROLE_KEY', 'UPSTASH_REDIS_REST_TOKEN',
      'R2_SECRET_ACCESS_KEY', 'AWS_SECRET_ACCESS_KEY', 'VERCEL_OIDC_TOKEN', 'UNRELATED_SECRET',
    ]) expect(child.env[key]).toBeUndefined()
    expect(child.args).toContain('--config=vitest.payment-qa.config.ts')
  })
})
