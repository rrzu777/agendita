// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  findFirst: vi.fn(),
  updateMany: vi.fn(),
  count: vi.fn(),
  analyticsInsightPreference: { findUnique: vi.fn() },
  businessUser: { findFirst: vi.fn() },
}))
const send = vi.hoisted(() => vi.fn())
vi.mock('@/lib/db', () => ({ prisma: { analyticsEmailDelivery: db, analyticsInsightPreference: db.analyticsInsightPreference, businessUser: db.businessUser } }))
vi.mock('@/lib/notifications/email-provider', () => ({ sendAnalyticsOperationalEmail: send }))

import { claimAnalyticsEmailDelivery, deliverAnalyticsEmailClaim } from '@/server/analytics/operations/email-outbox'

const now = new Date('2026-09-05T12:00:00.000Z')
const row = {
  id: '11111111-1111-4111-8111-111111111111',
  dedupeKey: 'analytics-incident:1:alert_open:1',
  recipients: ['ops@example.com'],
  subject: 'Subject', htmlBody: '<p>Body</p>', textBody: 'Body',
  status: 'pending', attempts: 0, firstProviderAttemptAt: null,
  createdAt: now, leaseExpiresAt: null,
}

describe('analytics email outbox', () => {
  beforeEach(() => {
    db.findFirst.mockResolvedValue(row)
    db.updateMany.mockResolvedValue({ count: 1 })
    db.count.mockResolvedValue(1)
    db.analyticsInsightPreference.findUnique.mockResolvedValue({ enabled: true, emailEnabled: true, recipientUserId: 'user-1' })
    db.businessUser.findFirst.mockResolvedValue({ id: 'membership-1' })
    send.mockResolvedValue({ success: true, messageId: 'msg_1' })
  })
  afterEach(() => vi.clearAllMocks())

  it('claims a pending delivery with a lease and frozen payload', async () => {
    const claim = await claimAnalyticsEmailDelivery(now)
    expect(claim).toMatchObject({ id: row.id, dedupeKey: row.dedupeKey, recipients: row.recipients, attempts: 1 })
    expect(db.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: row.id }),
      data: expect.objectContaining({ status: 'sending', attempts: { increment: 1 } }),
    }))
  })

  it('marks a successful provider response as sent', async () => {
    const claim = await claimAnalyticsEmailDelivery(now)
    expect(claim).not.toBeNull()
    const result = await deliverAnalyticsEmailClaim(claim!, now)
    expect(result).toEqual({ status: 'sent', messageId: 'msg_1' })
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ idempotencyKey: row.dedupeKey }))
    expect(db.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'sent', providerMessageId: 'msg_1' }) }))
  })

  it('cancels a weekly delivery when the global preference was disabled', async () => {
    db.findFirst.mockResolvedValue({ ...row, weeklyInsightId: 'weekly-1', recipientUserId: 'user-1', weeklyInsight: { businessId: 'biz-a' } })
    db.analyticsInsightPreference.findUnique.mockResolvedValue({ enabled: false, emailEnabled: true, recipientUserId: 'user-1' })
    await expect(claimAnalyticsEmailDelivery(now)).resolves.toBeNull()
    expect(db.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'cancelled' }) }))
  })

  it('retries an ambiguous result with the same delivery and stops at the cutoff', async () => {
    send.mockResolvedValue({ success: false, errorCode: 'provider_ambiguous' })
    const claim = await claimAnalyticsEmailDelivery(now)
    const retry = await deliverAnalyticsEmailClaim(claim!, now)
    expect(retry.status).toBe('failed')
    expect(db.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'ambiguous', nextAttemptAt: expect.any(Date) }) }))

    const oldClaim = { ...claim!, attempts: 3, firstProviderAttemptAt: new Date('2026-09-04T12:00:00.000Z') }
    const terminal = await deliverAnalyticsEmailClaim(oldClaim, now)
    expect(terminal.status).toBe('manual_review')
  })
})
