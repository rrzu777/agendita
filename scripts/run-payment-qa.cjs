#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports -- executable CommonJS script */

const { spawnSync } = require('node:child_process')
const { existsSync, mkdtempSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { delimiter, dirname, join } = require('node:path')
const { monthlyLocal, tenantLocal, postgres, scenarios } = require('./payment-qa-manifest.cjs')
const { paymentQaCommands } = require('./payment-qa-runtime.cjs')

function fail(message) {
  console.error(message)
  process.exit(1)
}

function childEnvironment(databaseUrl, scratchHome) {
  const nodeDirectory = dirname(process.execPath)
  const env = {
    PATH: [nodeDirectory, '/usr/bin', '/bin'].join(delimiter),
    HOME: scratchHome,
    TMPDIR: scratchHome,
    TMP: scratchHome,
    TEMP: scratchHome,
    USERPROFILE: scratchHome,
  }
  env.NODE_ENV = 'test'
  env.APP_ENV = 'test'
  env.TZ = 'UTC'
  env.PAYMENT_QA_OFFLINE = '1'
  if (databaseUrl) {
    env.TEST_DATABASE_URL = databaseUrl
    env.DATABASE_URL = databaseUrl
    env.DIRECT_URL = databaseUrl
  } else {
    delete env.TEST_DATABASE_URL
    delete env.DATABASE_URL
    delete env.DIRECT_URL
  }
  return env
}

function run(command, args, env) {
  const result = spawnSync(command, args, { stdio: 'inherit', env })
  if (result.error) {
    console.error('QA runner could not start trusted local CLI.')
    return 1
  }
  return result.status ?? 1
}

function printManifest() {
  for (const [scenario, files] of Object.entries(scenarios)) {
    console.log(`${scenario}: ${files.join(', ')}`)
  }
}

const args = new Set(process.argv.slice(2))
const known = new Set(['--list', '--postgres'])
for (const arg of args) if (!known.has(arg)) fail(`Unknown option: ${arg}`)

const allFiles = [...new Set([...monthlyLocal, ...tenantLocal, ...postgres])]
const missing = allFiles.filter((file) => !existsSync(file))
if (missing.length > 0) fail(`QA manifest references missing files: ${missing.join(', ')}`)

function validatedPostgresUrl() {
  if (process.env.NODE_ENV !== 'test') fail('PostgreSQL QA requires NODE_ENV=test.')
  const raw = process.env.TEST_DATABASE_URL
  if (!raw) fail('PostgreSQL QA requires TEST_DATABASE_URL.')
  let url
  try { url = new URL(raw) } catch { fail('TEST_DATABASE_URL must be a valid URL.') }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) fail('TEST_DATABASE_URL must use PostgreSQL.')
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) fail('TEST_DATABASE_URL must use a loopback host.')
  if (url.pathname !== '/agendita_payment_qa_test') fail('TEST_DATABASE_URL must target agendita_payment_qa_test.')
  if (!url.username || !url.password) fail('TEST_DATABASE_URL requires explicit test credentials.')
  if (url.search || url.hash) fail('TEST_DATABASE_URL must not contain query parameters or fragments.')
  if (process.env.DATABASE_URL !== raw || process.env.DIRECT_URL !== raw) fail('All PostgreSQL QA URLs must match exactly.')
  return raw
}

const databaseUrl = args.has('--postgres') ? validatedPostgresUrl() : undefined

printManifest()
if (args.has('--list')) process.exit(0)

const scratchHome = mkdtempSync(join(tmpdir(), 'agendita-payment-qa-home-'))
let status = 0
try {
  const env = childEnvironment(databaseUrl, scratchHome)
  const commands = paymentQaCommands()
  status = run(commands.vitest.executable, [
    commands.vitest.cli, '--run', ...monthlyLocal, ...tenantLocal,
    '--testTimeout=30000', '--maxWorkers=4', '--config=vitest.payment-qa.config.ts',
  ], env)

  if (status === 0 && args.has('--postgres')) {
    status = run(commands.prisma.executable, [commands.prisma.cli, 'migrate', 'deploy'], env)
    if (status === 0) {
      status = run(commands.vitest.executable, [commands.vitest.cli, '--run', '--config', 'vitest.payment-qa.integration.config.ts', ...postgres], env)
    }
  } else if (status === 0) {
    console.log('External sandbox and PostgreSQL QA remain pending; rerun with --postgres for local DB suites.')
  }
} finally {
  rmSync(scratchHome, { recursive: true, force: true })
}
if (status !== 0) process.exit(status)
