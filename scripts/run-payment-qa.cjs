#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports -- executable CommonJS script */

const { spawnSync } = require('node:child_process')
const { existsSync } = require('node:fs')
const { monthlyLocal, tenantLocal, postgres, scenarios } = require('./payment-qa-manifest.cjs')

function fail(message) {
  console.error(message)
  process.exit(1)
}

function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit', env: process.env })
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

printManifest()
if (args.has('--list')) process.exit(0)

run('npm', [
  'test', '--', ...monthlyLocal, ...tenantLocal,
  '--testTimeout=30000', '--maxWorkers=4',
])

if (args.has('--postgres')) {
  if (!process.env.TEST_DATABASE_URL || !process.env.DATABASE_URL || !process.env.DIRECT_URL) {
    fail('PostgreSQL QA requires TEST_DATABASE_URL, DATABASE_URL, and DIRECT_URL.')
  }
  run('npx', ['prisma', 'migrate', 'deploy'])
  run('npm', ['run', 'test:integration', '--', ...postgres])
} else {
  console.log('External sandbox and PostgreSQL QA remain pending; rerun with --postgres for local DB suites.')
}
