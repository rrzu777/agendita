import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, rm } from 'node:fs/promises'
import { once } from 'node:events'
import { configureCapture, captureNow } from '../helpers/analytics-capture'
import { reserveAnalyticsBudget, checkAnalyticsRateLimit } from '@/lib/analytics/budget'

const redis = vi.hoisted(() => ({ socket: '' }))
vi.mock('@/lib/upstash-rest', async () => {
  const { execFile } = await import('node:child_process')
  const { promisify } = await import('node:util')
  return { executeUpstashCommand: async ({ command, args }: { command: string; args: (string | number)[] }) => {
    const { stdout } = await promisify(execFile)('redis-cli', ['-s', redis.socket, '--json', command, ...args.map(String)])
    return JSON.parse(stdout)
  } }
})

describe('actual isolated Redis EVAL budget concurrency', () => {
  let directory: string
  let child: ChildProcess
  beforeAll(async () => {
    // Ephemeral Unix socket only: no TCP listener, no persistence, no existing Redis touched.
    directory = await mkdtemp('/tmp/owner-analytics-redis-')
    redis.socket = `${directory}/redis.sock`
    child = spawn('redis-server', ['--port', '0', '--unixsocket', redis.socket, '--save', '', '--appendonly', 'no'], { stdio: ['ignore', 'pipe', 'pipe'] })
    await new Promise<void>((resolve, reject) => {
      child.once('error', reject)
      child.once('exit', (code) => reject(new Error(`Disposable Redis exited: ${code}`)))
      child.stdout?.on('data', (chunk) => { if (/ready to accept connections/i.test(String(chunk))) resolve() })
    })
  })
  afterEach(() => vi.unstubAllEnvs())
  afterAll(async () => {
    if (child && child.exitCode === null) { child.kill('SIGTERM'); await once(child, 'exit') }
    if (directory) await rm(directory, { recursive: true, force: true })
  })
  it('atomically limits concurrent tenants globally without charging either counter on denial', async () => {
    configureCapture('redis-a,redis-b')
    vi.stubEnv('OWNER_ANALYTICS_GLOBAL_DAILY_BUDGET', '5')
    vi.stubEnv('OWNER_ANALYTICS_TENANT_DAILY_BUDGET', '3')
    const results = await Promise.all(Array.from({ length: 20 }, (_, index) => reserveAnalyticsBudget({ businessId: index % 2 ? 'redis-a' : 'redis-b', cost: 1, now: captureNow })))
    expect(results.filter(Boolean)).toHaveLength(5)
    const prefix = 'owner-analytics:budget:{capture}:2026-08-31'
    const { stdout } = await promisify(execFile)('redis-cli', ['-s', redis.socket, '--json', 'MGET', `${prefix}:global`, `${prefix}:tenant:redis-a`, `${prefix}:tenant:redis-b`])
    const counts = JSON.parse(stdout).map(Number)
    expect(counts[0]).toBe(5)
    expect(counts[1] + counts[2]).toBe(5)
    expect(Math.max(counts[1], counts[2])).toBe(3)
    expect(await reserveAnalyticsBudget({ businessId: 'redis-a', cost: 1, now: captureNow })).toBe(false)
  })
  it('enforces isolated bootstrap and batch windows with their actual Lua scripts', async () => {
    configureCapture('redis-rate')
    const bootstrap = await Promise.all(Array.from({ length: 12 }, () => checkAnalyticsRateLimit({ businessId: 'redis-rate', kind: 'bootstrap', identity: 'ip-a' })))
    const batches = await Promise.all(Array.from({ length: 32 }, () => checkAnalyticsRateLimit({ businessId: 'redis-rate', kind: 'batch', identity: 'attempt-a' })))
    expect(bootstrap.filter(Boolean)).toHaveLength(10)
    expect(batches.filter(Boolean)).toHaveLength(30)
    expect(await checkAnalyticsRateLimit({ businessId: 'redis-rate', kind: 'bootstrap', identity: 'ip-b' })).toBe(true)
  })
})
