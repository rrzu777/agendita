#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports -- executable CommonJS script */

const { spawnSync } = require('node:child_process')
const { existsSync } = require('node:fs')
const { monthlyLocal, tenantLocal, postgres, scenarios } = require('./payment-qa-manifest.cjs')

function fail(message) {
  console.error(message)
  process.exit(1)
}

function childEnvironment(databaseUrl) {
  const env = { ...process.env, NODE_ENV: 'test', PAYMENT_QA_OFFLINE: '1' }
  for (const key of Object.keys(env)) {
    if (/MERCADO_PAGO|(^|_)MP_|RESEND|EMAIL|PAYMENT_PROVIDER|ALLOW_MOCK_PAYMENTS/i.test(key)) delete env[key]
  }
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
  if (result.error) fail(`QA runner could not start ${command}.`)
  if (result.status !== 0) process.exit(result.status ?? 1)
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

const env = childEnvironment(databaseUrl)

run('npm', [
  'test', '--', ...monthlyLocal, ...tenantLocal,
  '--testTimeout=30000', '--maxWorkers=4', '--config=vitest.payment-qa.config.ts',
], env)

if (args.has('--postgres')) {
  run('./node_modules/.bin/prisma', ['migrate', 'deploy'], env)
  run('./node_modules/.bin/vitest', ['--run', '--config', 'vitest.payment-qa.integration.config.ts', ...postgres], env)
} else {
  console.log('External sandbox and PostgreSQL QA remain pending; rerun with --postgres for local DB suites.')
}
