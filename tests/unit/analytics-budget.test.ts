// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getAnalyticsCaptureConfig, reserveAnalyticsBudget, checkAnalyticsRateLimit } from '@/lib/analytics/budget'
import { captureNow, configureCapture } from '../helpers/analytics-capture'

const execute = vi.hoisted(() => vi.fn())
vi.mock('@/lib/upstash-rest', () => ({ executeUpstashCommand: execute }))
describe('analytics capture configuration and atomic budget boundary', () => {
  beforeEach(() => { configureCapture(); execute.mockReset().mockResolvedValue(1) })
  afterEach(() => vi.unstubAllEnvs())
  it('accepts only explicit and complete configuration', () => {
    expect(getAnalyticsCaptureConfig('biz-a')).not.toBeNull()
    expect(getAnalyticsCaptureConfig('biz-b')).toBeNull()
  })
  it.each(['OWNER_ANALYTICS_ENABLED', 'OWNER_ANALYTICS_PRIVACY_APPROVED', 'OWNER_ANALYTICS_PILOT_APPROVED', 'OWNER_ANALYTICS_SECRET', 'OWNER_ANALYTICS_GLOBAL_DAILY_BUDGET', 'OWNER_ANALYTICS_TENANT_DAILY_BUDGET', 'OWNER_ANALYTICS_VERIFIED_DAILY_DRAIN', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN'])('fails closed with missing %s', (key) => {
    vi.stubEnv(key, '')
    expect(getAnalyticsCaptureConfig('biz-a')).toBeNull()
  })
  it('refuses nonfinite budgets and budget above verified drain', () => {
    for (const value of ['Infinity', '0', '-1', '1.5', '2000']) {
      vi.stubEnv('OWNER_ANALYTICS_GLOBAL_DAILY_BUDGET', value)
      expect(getAnalyticsCaptureConfig('biz-a')).toBeNull()
    }
  })
  it('reserves both isolated keys in ONE flat EVAL', async () => {
    expect(await reserveAnalyticsBudget({ businessId: 'biz-a', cost: 20, now: captureNow })).toBe(true)
    expect(execute).toHaveBeenCalledTimes(1)
    const call = execute.mock.calls[0][0]
    expect(call.command).toBe('EVAL')
    expect(call.args.slice(1, 4)).toEqual([2, 'owner-analytics:budget:{capture}:2026-08-31:global', 'owner-analytics:budget:{capture}:2026-08-31:tenant:biz-a'])
    expect(call.args.slice(4, 7)).toEqual([1000, 500, 20])
  })
  it('denials, network failure and unexpected response fail closed', async () => {
    for (const response of [0, '1', [1], null]) {
      execute.mockResolvedValueOnce(response)
      expect(await reserveAnalyticsBudget({ businessId: 'biz-a', cost: 1, now: captureNow })).toBe(false)
    }
    execute.mockRejectedValueOnce(new Error('secret payload must never be logged'))
    expect(await reserveAnalyticsBudget({ businessId: 'biz-a', cost: 1, now: captureNow })).toBe(false)
  })
  it('uses isolated distributed bootstrap and stream buckets, never booking/payment buckets', async () => {
    expect(await checkAnalyticsRateLimit({ businessId: 'biz-a', kind: 'bootstrap', identity: '127.0.0.1' })).toBe(true)
    expect(await checkAnalyticsRateLimit({ businessId: 'biz-a', kind: 'batch', identity: 'attempt:abc' })).toBe(true)
    const calls = execute.mock.calls.map(([call]) => call)
    expect(calls[0].args[2]).toMatch(/^owner-analytics:rate:bootstrap:/)
    expect(calls[1].args[2]).toMatch(/^owner-analytics:rate:batch:/)
    expect(calls[0].args.slice(3)).toEqual([10, 60])
    expect(calls[1].args.slice(3)).toEqual([30, 60])
    execute.mockRejectedValueOnce(new Error('unreachable'))
    expect(await checkAnalyticsRateLimit({ businessId: 'biz-a', kind: 'batch', identity: 'attempt:abc' })).toBe(false)
  })
})
