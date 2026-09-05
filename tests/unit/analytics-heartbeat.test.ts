// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  transaction: vi.fn(),
  findUnique: vi.fn(),
  upsert: vi.fn(),
  updateMany: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  prisma: {
    $transaction: db.transaction,
    analyticsJobHeartbeat: {
      findUnique: db.findUnique,
      upsert: db.upsert,
      updateMany: db.updateMany,
    },
  },
}))

import {
  finishAnalyticsJobRun,
  recordAnalyticsJobProgress,
  startAnalyticsJobRun,
} from '@/server/analytics/operations/heartbeat'

const runId = '11111111-1111-4111-8111-111111111111'
const leaseToken = '22222222-2222-4222-8222-222222222222'
const now = new Date('2026-09-05T12:00:00.000Z')

describe('durable analytics heartbeat fencing', () => {
  beforeEach(() => {
    db.transaction.mockImplementation(async (callback: (tx: unknown) => unknown) => callback({
      analyticsJobHeartbeat: { findUnique: db.findUnique, upsert: db.upsert },
    }))
    db.findUnique.mockResolvedValue(null)
    db.upsert.mockResolvedValue({ nextBatchSequence: 1 })
    db.updateMany.mockResolvedValue({ count: 1 })
  })

  afterEach(() => vi.clearAllMocks())

  it('starts a run with a fresh fence and sequence one', async () => {
    const run = await startAnalyticsJobRun('owner_analytics_maintenance', now)
    expect(run.jobKey).toBe('owner_analytics_maintenance')
    expect(run.batchSequence).toBe(1)
    expect(run.runId).toMatch(/^[0-9a-f-]{36}$/i)
    expect(run.leaseToken).toMatch(/^[0-9a-f-]{36}$/i)
    expect(db.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { jobKey: 'owner_analytics_maintenance' },
      create: expect.objectContaining({ lastStatus: 'running', nextBatchSequence: 1 }),
      update: expect.objectContaining({ lastStatus: 'running', nextBatchSequence: 1 }),
      select: { nextBatchSequence: true },
    }))
  })

  it('refuses a second worker while the lease is live', async () => {
    db.findUnique.mockResolvedValue({ lastStatus: 'running', leaseExpiresAt: new Date('2026-09-05T12:05:00.000Z') })
    await expect(startAnalyticsJobRun('owner_analytics_maintenance', now)).rejects.toThrow('analytics_job_busy')
    expect(db.upsert).not.toHaveBeenCalled()
  })

  it('records progress without marking success', async () => {
    await recordAnalyticsJobProgress({
      jobKey: 'owner_analytics_maintenance', runId, leaseToken, batchSequence: 3,
      hasMore: true, errors: 0, nextCursor: 'cleanup:v1', now,
    })
    expect(db.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ currentRunId: runId, leaseToken, nextBatchSequence: 3 }),
      data: expect.objectContaining({ nextBatchSequence: 4, lastProgressAt: now }),
    }))
    expect(db.updateMany.mock.calls[0][0].data).not.toHaveProperty('lastSuccessAt')
  })

  it('finishes only the current fence and updates the right counters', async () => {
    await expect(finishAnalyticsJobRun({
      jobKey: 'owner_analytics_maintenance', runId, leaseToken, status: 'succeeded',
      result: { errors: 0, hasMore: false }, now,
    })).resolves.toBe(true)
    expect(db.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { jobKey: 'owner_analytics_maintenance', currentRunId: runId, leaseToken, leaseExpiresAt: { gt: now } },
      data: expect.objectContaining({ lastSuccessAt: now, lastStatus: 'succeeded', consecutiveFailures: 0 }),
    }))
  })

  it('reports a stale completion without mutating if the fence disappeared', async () => {
    db.updateMany.mockResolvedValueOnce({ count: 0 })
    await expect(finishAnalyticsJobRun({
      jobKey: 'owner_analytics_maintenance', runId, leaseToken, status: 'failed',
      result: { errors: 1 }, now,
    })).resolves.toBe(false)
  })
})
