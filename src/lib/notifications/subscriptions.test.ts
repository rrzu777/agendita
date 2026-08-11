import { describe, expect, it, vi } from 'vitest'
import {
  buildSubscriptionNotification,
  sendSubscriptionNotification,
  subscriptionNotificationDedupeKey,
  type SubscriptionNotificationDependencies,
  type SubscriptionNotificationKind,
} from './subscriptions'

const NOW = new Date('2026-08-11T12:00:00.000Z')
const EFFECTIVE_DATE = new Date('2026-08-18T12:00:00.000Z')
const SAFE_DATA = {
  businessId: 'business-safe-fixture',
  subscriptionId: 'subscription-safe-fixture',
  effectiveDate: EFFECTIVE_DATE,
}

function createDependencies(): SubscriptionNotificationDependencies {
  let status: 'pending' | 'sent' | 'failed' | 'manual_review' = 'pending'
  let nextAttemptAt: Date | null = null
  let firstProviderAttemptAt: Date | null = null
  let createdAt = NOW
  const deliveries = new Set<string>()
  return {
    prisma: {
      subscriptionNotificationDelivery: {
        createMany: vi.fn(async ({ data }) => {
          const key = data[0].dedupeKey
          if (deliveries.has(key)) return { count: 0 }
          deliveries.add(key)
          createdAt = NOW
          return { count: 1 }
        }),
        findUnique: vi.fn().mockImplementation(async ({ select }) => select.firstProviderAttemptAt
          ? { firstProviderAttemptAt }
          : { recipientEmails: ['owner@example.test'], businessNameSnapshot: 'Salón Seguro' }),
        updateMany: vi.fn(async ({ where, data }) => {
          if (data.status === 'sent' || data.status === 'failed' || data.status === 'manual_review') {
            status = data.status
            nextAttemptAt = data.nextAttemptAt
            return { count: 1 }
          }
          const retryAt = where.OR?.[0]?.OR?.[1]?.nextAttemptAt?.lte ?? where.OR?.[1]?.nextAttemptAt?.lte
          const oldestAllowed = where.createdAt?.gte
          if (oldestAllowed instanceof Date && createdAt < oldestAllowed) return { count: 0 }
          const canClaim = status === 'pending'
            ? nextAttemptAt === null || (retryAt instanceof Date && nextAttemptAt <= retryAt)
            : status === 'failed' && nextAttemptAt instanceof Date && retryAt instanceof Date && nextAttemptAt <= retryAt
          if (!canClaim) return { count: 0 }
          if (data.status === 'pending' && data.nextAttemptAt instanceof Date) {
            status = 'pending'
            nextAttemptAt = data.nextAttemptAt
            firstProviderAttemptAt = data.firstProviderAttemptAt ?? firstProviderAttemptAt
          }
          return { count: 1 }
        }),
      },
      business: {
        findUnique: vi.fn().mockResolvedValue({
          name: 'Salón Seguro',
          users: [{ user: { email: 'owner@example.test' } }],
        }),
      },
    },
    sendEmail: vi.fn().mockResolvedValue({ success: true }),
    now: () => NOW,
  } as unknown as SubscriptionNotificationDependencies
}

describe('subscription notifications', () => {
  it.each<SubscriptionNotificationKind>([
    'subscription_due_7_days',
    'subscription_due_3_days',
    'subscription_due_1_day',
    'subscription_activated',
    'subscription_payment_approved',
    'subscription_payment_failed',
    'subscription_recovered',
    'subscription_suspended',
    'subscription_cancellation_requested',
    'subscription_cancelled',
    'subscription_oauth_expired',
  ])('renders the %s lifecycle notice without payment or provider data', (kind) => {
    const notification = buildSubscriptionNotification(kind, {
      ...SAFE_DATA,
      businessName: 'Salón Seguro',
    })
    const content = `${notification.subject}\n${notification.html}\n${notification.text}`

    expect(content).toContain('Salón Seguro')
    expect(content).not.toContain(SAFE_DATA.subscriptionId)
    expect(content).not.toContain('provider-subscription-id')
    expect(content).not.toContain('access-token')
    expect(content).not.toContain('4111')
  })

  it('builds a stable dedupe key from subscription, kind, and effective date', () => {
    expect(subscriptionNotificationDedupeKey('subscription-safe-fixture', 'subscription_due_7_days', EFFECTIVE_DATE))
      .toBe('subscription-safe-fixture:subscription_due_7_days:2026-08-18T12:00:00.000Z')
  })

  it('allows only one concurrent owner to send the same delivery', async () => {
    const dependencies = createDependencies()
    const [first, second] = await Promise.all([
      sendSubscriptionNotification('subscription_due_7_days', SAFE_DATA, dependencies),
      sendSubscriptionNotification('subscription_due_7_days', SAFE_DATA, dependencies),
    ])

    expect([first.status, second.status].sort()).toEqual(['sent', 'skipped'])
    expect(dependencies.sendEmail).toHaveBeenCalledTimes(1)
    expect(dependencies.sendEmail).toHaveBeenCalledWith(expect.objectContaining({
      idempotencyKey: subscriptionNotificationDedupeKey(
        SAFE_DATA.subscriptionId,
        'subscription_due_7_days',
        EFFECTIVE_DATE,
      ),
    }))
  })

  it('marks a failed send retryable without rolling back unrelated work', async () => {
    const dependencies = createDependencies()
    dependencies.sendEmail = vi.fn().mockResolvedValue({ success: false, error: 'provider unavailable' })

    await expect(sendSubscriptionNotification('subscription_payment_failed', SAFE_DATA, dependencies))
      .resolves.toMatchObject({ status: 'failed' })

    expect(dependencies.prisma.subscriptionNotificationDelivery.updateMany).toHaveBeenLastCalledWith({
      where: expect.objectContaining({ status: 'pending' }),
      data: expect.objectContaining({ status: 'failed', lastErrorCode: 'send_failed' }),
    })
  })

  it('retries Resend concurrent_idempotent_requests with the identical idempotency key', async () => {
    const dependencies = createDependencies()
    ;(dependencies.prisma.business.findUnique as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        name: 'Salón Seguro',
        users: [{ user: { email: 'z-owner@example.test' } }, { user: { email: 'a-owner@example.test' } }],
      })
      .mockResolvedValueOnce({
        name: 'Salón Seguro',
        users: [{ user: { email: 'a-owner@example.test' } }, { user: { email: 'z-owner@example.test' } }],
      })
    dependencies.sendEmail = vi.fn()
      .mockResolvedValueOnce({ success: false, error: 'request in progress', errorCode: 'concurrent_idempotent_requests' })
      .mockResolvedValueOnce({ success: true })

    await sendSubscriptionNotification('subscription_payment_approved', SAFE_DATA, dependencies)
    const retry = await sendSubscriptionNotification('subscription_payment_approved', SAFE_DATA, {
      ...dependencies,
      now: () => new Date(NOW.getTime() + 2 * 60 * 1000),
    })

    expect(retry.status).toBe('sent')
    expect(dependencies.sendEmail).toHaveBeenCalledTimes(2)
    const sendEmail = dependencies.sendEmail as unknown as ReturnType<typeof vi.fn>
    expect(sendEmail.mock.calls[0][0].idempotencyKey)
      .toBe(sendEmail.mock.calls[1][0].idempotencyKey)
    expect(sendEmail.mock.calls[0][0].to).toEqual(['owner@example.test'])
    expect(sendEmail.mock.calls[1][0].to).toEqual(['owner@example.test'])
  })

  it('stops an invalid_idempotent_request instead of retrying a conflicting payload', async () => {
    const dependencies = createDependencies()
    dependencies.sendEmail = vi.fn().mockResolvedValue({
      success: false,
      error: 'payload differs',
      errorCode: 'invalid_idempotent_request',
    })

    await expect(sendSubscriptionNotification('subscription_payment_approved', SAFE_DATA, dependencies))
      .resolves.toMatchObject({ status: 'failed' })
    await expect(sendSubscriptionNotification('subscription_payment_approved', SAFE_DATA, {
      ...dependencies,
      now: () => new Date(NOW.getTime() + 2 * 60 * 1000),
    })).resolves.toMatchObject({ status: 'skipped' })

    expect(dependencies.sendEmail).toHaveBeenCalledTimes(1)
    const failedUpdate = (dependencies.prisma.subscriptionNotificationDelivery.updateMany as ReturnType<typeof vi.fn>)
      .mock.calls.find(([input]) => input.data.status === 'manual_review')
    expect(failedUpdate).toEqual([{
      where: expect.objectContaining({ status: 'pending' }),
      data: expect.objectContaining({ status: 'manual_review', nextAttemptAt: null, lastErrorCode: 'idempotency_conflict' }),
    }])
  })

  it('does not retry an ambiguous delivery after Resend idempotency expires', async () => {
    const dependencies = createDependencies()
    dependencies.sendEmail = vi.fn().mockResolvedValue({ success: false, errorCode: 'application_error' })

    await sendSubscriptionNotification('subscription_payment_approved', SAFE_DATA, dependencies)
    await expect(sendSubscriptionNotification('subscription_payment_approved', SAFE_DATA, {
      ...dependencies,
      now: () => new Date(NOW.getTime() + 24 * 60 * 60 * 1000),
    })).resolves.toMatchObject({ status: 'skipped' })

    expect(dependencies.sendEmail).toHaveBeenCalledTimes(1)
  })
})
