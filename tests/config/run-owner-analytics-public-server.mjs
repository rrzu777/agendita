import { spawn, execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createServer as createHttpsServer } from 'node:https'
import { createServer as createTcpServer } from 'node:net'
import { once } from 'node:events'
import { createInterface } from 'node:readline'
import { databaseUrl, fixture, guardedPrisma, seedPublicFixture, cleanPublicFixture } from './owner-analytics-public-fixture.mjs'

for (const name of ['.env', '.env.local', '.env.development', '.env.development.local']) {
  if (existsSync(join(process.cwd(), name))) throw new Error(`Refusing environment file ${name}`)
}
for (const port of [3555, 3556]) {
  const probe = createTcpServer()
  probe.listen(port, '127.0.0.1')
  await once(probe, 'listening')
  await new Promise(resolve => probe.close(resolve))
}
const prisma = guardedPrisma()
const directory = mkdtempSync(join(tmpdir(), 'owner-analytics-public-'))
const socket = join(directory, 'redis.sock')
let redis, next, adapter, seeded = false, stopping = false

async function stop(code = 0) {
  if (stopping) return
  stopping = true
  for (const child of [next, redis]) {
    if (child && child.exitCode === null) {
      child.kill('SIGTERM')
      await once(child, 'exit')
    }
  }
  if (adapter?.listening) await new Promise(resolve => adapter.close(resolve))
  if (seeded) await cleanPublicFixture(prisma)
  await prisma.$disconnect()
  // Exact directory created above; never a glob or another app's data.
  rmSync(directory, { recursive: true, force: true })
  process.exitCode = code
}
process.on('SIGTERM', () => void stop())
process.on('SIGINT', () => void stop())

try {
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(directory, 'key.pem'), '-out', join(directory, 'cert.pem'), '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1'], { stdio: 'ignore' })
  redis = spawn('redis-server', ['--port', '0', '--unixsocket', socket, '--unixsocketperm', '700', '--save', '', '--appendonly', 'no'], { stdio: ['ignore', 'pipe', 'pipe'] })
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Redis socket startup timed out')), 10000)
    redis.once('error', reject)
    redis.stdout.on('data', chunk => {
      if (chunk.toString().includes('ready to accept connections')) { clearTimeout(timer); resolve() }
    })
  })
  adapter = createHttpsServer({ key: readFileSync(join(directory, 'key.pem')), cert: readFileSync(join(directory, 'cert.pem')) }, async (request, response) => {
    response.setHeader('Content-Type', 'application/json')
    if (request.method !== 'POST' || request.url !== '/' || request.headers.authorization !== 'Bearer synthetic-local-redis') {
      response.writeHead(403).end(JSON.stringify({ error: 'forbidden' })); return
    }
    try {
      let body = ''
      for await (const chunk of request) { body += chunk; if (Buffer.byteLength(body) > 32768) throw new Error('body limit') }
      const command = JSON.parse(body)
      if (!Array.isArray(command) || command[0] !== 'EVAL' || command.some(item => !['string', 'number'].includes(typeof item))) throw new Error('command shape')
      const result = execFileSync('redis-cli', ['-s', socket, '--json', ...command.map(String)], { encoding: 'utf8', timeout: 2000 })
      response.end(JSON.stringify({ result: JSON.parse(result) }))
    } catch { response.writeHead(400).end(JSON.stringify({ error: 'invalid local command' })) }
  })
  adapter.listen(3556, '127.0.0.1')
  await once(adapter, 'listening')
  await seedPublicFixture(prisma)
  seeded = true
  next = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '--hostname', '127.0.0.1', '--port', '3555'], {
    cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'], env: {
      PATH: process.env.PATH ?? '', DATABASE_URL: databaseUrl, DIRECT_URL: databaseUrl,
      NEXT_PUBLIC_SUPABASE_URL: 'https://analytics-e2e.invalid', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'analytics-e2e-anon-key',
      // Next16 dev normalizes the Request URL's loopback hostname to localhost.
      APP_DOMAIN: 'localhost:3555', NEXT_PUBLIC_APP_DOMAIN: 'localhost:3555', PAYMENT_PROVIDER: 'manual',
      OWNER_ANALYTICS_ENABLED: 'true', OWNER_ANALYTICS_BUSINESS_IDS: fixture.businessId,
      OWNER_ANALYTICS_SECRET: 'synthetic-owner-analytics-secret-32-bytes', OWNER_ANALYTICS_PRIVACY_APPROVED: 'true', OWNER_ANALYTICS_PILOT_APPROVED: 'true',
      OWNER_ANALYTICS_GLOBAL_DAILY_BUDGET: '20000', OWNER_ANALYTICS_TENANT_DAILY_BUDGET: '10000', OWNER_ANALYTICS_VERIFIED_DAILY_DRAIN: '40000',
      UPSTASH_REDIS_REST_URL: 'https://127.0.0.1:3556', UPSTASH_REDIS_REST_TOKEN: 'synthetic-local-redis',
      NODE_EXTRA_CA_CERTS: join(directory, 'cert.pem'), ENABLE_E2E_AUTH_BYPASS: 'true', E2E_AUTH_BYPASS_SECRET: 'owner-analytics-e2e-secret',
      RESEND_API_KEY: '', FROM_EMAIL: '', VAPID_PRIVATE_KEY: '', NEXT_PUBLIC_VAPID_PUBLIC_KEY: '', NEXT_TELEMETRY_DISABLED: '1',
      ENCRYPTION_KEY: 'owner-analytics-e2e-key-32-bytes',
    },
  })
  for (const [input, output] of [[next.stdout, process.stdout], [next.stderr, process.stderr]]) {
    createInterface({ input }).on('line', line => {
      // Behavioral config guard: fail rather than retain automatic action arguments/credentials.
      // Requests and all ordinary application warnings/errors still flow unchanged.
      if (line.includes('└─ ƒ ')) {
        console.error('Unsafe automatic Server Function argument log detected (arguments withheld)')
        void stop(1)
      } else output.write(`${line}\n`)
    })
  }
  next.once('exit', code => { if (!stopping) void stop(code ?? 1) })
  console.log(`Synthetic public fixture: http://localhost:3555/book/${fixture.slug}?acq=${fixture.linkToken}`)
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Public QA harness failed')
  await stop(1)
}
