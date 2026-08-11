import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join, sep } from 'node:path'
import { spawnSync } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'
import runtime from '../../scripts/payment-qa-runtime.cjs'

const ROOT = process.cwd()
const RUNNER = join(ROOT, 'scripts/run-payment-qa.cjs')
const temporaryDirectories = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function hostileExecutionEnvironment(extraEnv = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'agendita-payment-qa-'))
  temporaryDirectories.push(directory)
  const output = join(directory, 'hostile-executed')
  const executable = join(directory, 'hostile')
  writeFileSync(executable, `#!/bin/sh\ntouch ${JSON.stringify(output)}\nexit 99\n`)
  chmodSync(executable, 0o755)
  for (const name of ['npm', 'node']) {
    const path = join(directory, name)
    writeFileSync(path, `#!/bin/sh\nexec ${JSON.stringify(executable)}\n`)
    chmodSync(path, 0o755)
  }
  writeFileSync(join(directory, '.npmrc'), `script-shell=${executable}\nnode-options=--require=${directory}/evil.js\n`)
  return {
    output,
    env: { ...process.env, HOME: directory, PATH: `${directory}${delimiter}${process.env.PATH}`, ...extraEnv },
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
    const fake = hostileExecutionEnvironment({
      ...overrides,
      DATABASE_URL: overrides.TEST_DATABASE_URL,
      DIRECT_URL: overrides.TEST_DATABASE_URL,
    })
    const result = run(['--postgres'], fake.env)
    expect(result.status).not.toBe(0)
    expect(existsSync(fake.output)).toBe(false)
  })

  it('rejects parent database URL mismatches before spawning a child', () => {
    const safe = 'postgresql://postgres:test@127.0.0.1:5432/agendita_payment_qa_test'
    const fake = hostileExecutionEnvironment({
      NODE_ENV: 'test', TEST_DATABASE_URL: safe, DATABASE_URL: safe,
      DIRECT_URL: 'postgresql://postgres:test@127.0.0.1:5432/other',
    })
    const result = run(['--postgres'], fake.env)
    expect(result.status).not.toBe(0)
    expect(existsSync(fake.output)).toBe(false)
  })

  it('uses absolute trusted local CLIs through the current Node executable', () => {
    const commands = runtime.paymentQaCommands(ROOT)
    expect(Object.values(commands).every((command) => command.executable === process.execPath)).toBe(true)
    expect(Object.values(commands).every((command) => command.cli.startsWith(join(ROOT, 'node_modules') + sep))).toBe(true)
  })

  it('ignores hostile PATH, HOME npm config, node and npm shims', () => {
    const fake = hostileExecutionEnvironment({
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
    expect(existsSync(fake.output)).toBe(false)
  }, 30000)
})
