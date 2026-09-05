// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'

const findInsight = vi.hoisted(() => vi.fn())
const createDelivery = vi.hoisted(() => vi.fn())
vi.mock('@/lib/db', () => ({ prisma: { analyticsWeeklyInsight: { findUnique: findInsight }, analyticsEmailDelivery: { create: createDelivery } } }))

import { queueWeeklyInsightDigest } from '@/server/analytics/operations/email-outbox'

describe('weekly insight email payload', () => {
  afterEach(() => vi.clearAllMocks())

  it('freezes one deterministic payload under a stable dedupe key', async () => {
    findInsight.mockResolvedValue({ id: 'weekly-1', sourceExpiresAt: new Date('2026-11-30T00:00:00Z'), facts: { version: 1, matureCompleteAttempts: 20, conversion: { numerator: 2, denominator: 20 } }, narrative: null })
    createDelivery.mockResolvedValue({ id: 'delivery-1' })
    await expect(queueWeeklyInsightDigest({ weeklyInsightId: 'weekly-1', recipientUserId: 'user-1', recipientEmail: 'owner@example.com', now: new Date('2026-09-05T00:00:00Z') })).resolves.toBe(true)
    expect(createDelivery).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ dedupeKey: 'analytics-weekly:weekly-1:weekly_digest', notificationKind: 'weekly_digest', recipients: ['owner@example.com'] }) }))
  })

  it('treats a duplicate dedupe key as already queued', async () => {
    findInsight.mockResolvedValue({ id: 'weekly-1', sourceExpiresAt: new Date('2026-11-30T00:00:00Z'), facts: {}, narrative: null })
    createDelivery.mockRejectedValue({ code: 'P2002' })
    await expect(queueWeeklyInsightDigest({ weeklyInsightId: 'weekly-1', recipientUserId: 'user-1', recipientEmail: 'owner@example.com' })).resolves.toBe(false)
  })
})
