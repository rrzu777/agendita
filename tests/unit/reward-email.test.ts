import { describe, expect, it, vi, beforeEach } from 'vitest'

const sendLoyaltyRewardNotification = vi.hoisted(() => vi.fn(async () => ({ success: true })))
vi.mock('@/lib/notifications', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/notifications')>()
  return {
    ...actual,
    sendLoyaltyRewardNotification,
    getBusinessReplyToEmail: vi.fn(async () => null),
    // sendNotificationSafely calls the fn and returns its result — keep real behavior:
    sendNotificationSafely: async (_label: string, fn: () => Promise<unknown>) => fn(),
  }
})

// ensureLoyaltyToken hits the DB; stub the token module.
vi.mock('@/lib/loyalty/token', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/loyalty/token')>()
  return {
    ...actual,
    ensureLoyaltyToken: vi.fn(async () => 'tok-abc'),
    buildLoyaltyCardLink: vi.fn(async () => 'https://x/tarjeta/tok-abc'),
  }
})

import { sendRewardEmail } from '@/lib/loyalty/reward-email'

const baseCustomer = {
  id: 'c1', name: 'Ana', email: 'ana@example.com', loyaltyToken: 'tok-abc', marketingOptOutAt: null as Date | null,
}
const baseArgs = {
  businessId: 'b1', businessName: 'Studio', config: { isActive: true }, rewardLabel: '20% off',
}

describe('sendRewardEmail opt-out gate', () => {
  beforeEach(() => vi.clearAllMocks())

  it('birthday con opt-out: NO envía', async () => {
    await sendRewardEmail({ ...baseArgs, customer: { ...baseCustomer, marketingOptOutAt: new Date() }, reason: 'birthday' })
    expect(sendLoyaltyRewardNotification).not.toHaveBeenCalled()
  })

  it('winback sin opt-out: envía con unsubscribeToken', async () => {
    await sendRewardEmail({ ...baseArgs, customer: baseCustomer, reason: 'winback' })
    expect(sendLoyaltyRewardNotification).toHaveBeenCalledTimes(1)
    expect(sendLoyaltyRewardNotification.mock.calls[0][0]).toMatchObject({ unsubscribeToken: 'tok-abc' })
  })

  it('referral con opt-out: envía igual y SIN unsubscribeToken (agradecimiento)', async () => {
    await sendRewardEmail({ ...baseArgs, customer: { ...baseCustomer, marketingOptOutAt: new Date() }, reason: 'referral' })
    expect(sendLoyaltyRewardNotification).toHaveBeenCalledTimes(1)
    expect(sendLoyaltyRewardNotification.mock.calls[0][0]).toMatchObject({ unsubscribeToken: null })
  })
})
