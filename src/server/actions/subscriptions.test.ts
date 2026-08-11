import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireBusinessRole: vi.fn(),
  findSubscription: vi.fn(),
  findPayments: vi.fn(),
}))

vi.mock('@/lib/auth/server', () => ({
  requireBusinessRole: (...args: unknown[]) => mocks.requireBusinessRole(...args),
}))

vi.mock('@/lib/db', () => ({
  prisma: {
    businessSubscription: { findFirst: (...args: unknown[]) => mocks.findSubscription(...args) },
    subscriptionPayment: { findMany: (...args: unknown[]) => mocks.findPayments(...args) },
  },
}))

import { getCurrentSubscription } from './subscriptions'

describe('getCurrentSubscription', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.requireBusinessRole.mockResolvedValue({ businessId: 'business-1' })
    mocks.findSubscription.mockResolvedValue({
      id: 'subscription-1',
      status: 'active',
      providerSubscriptionId: 'provider-subscription-secret',
      plan: { name: 'Plan Pro', priceMonthly: 19_990 },
    })
    mocks.findPayments.mockResolvedValue([])
  })

  it('derives the tenant from auth and returns only a boolean for provider authorization', async () => {
    const result = await getCurrentSubscription()

    expect(mocks.requireBusinessRole).toHaveBeenCalledWith(['owner', 'admin'])
    expect(mocks.findSubscription).toHaveBeenCalledWith(expect.objectContaining({
      where: { businessId: 'business-1' },
    }))
    expect(mocks.findPayments).toHaveBeenCalledWith(expect.objectContaining({
      where: { businessId: 'business-1' },
    }))
    expect(result.subscription).toMatchObject({
      id: 'subscription-1', hasProviderSubscription: true,
    })
    expect(result.subscription).not.toHaveProperty('providerSubscriptionId')
  })

  it('does not select provider IDs or raw payloads for the owner-facing payment history', async () => {
    await getCurrentSubscription()

    const subscriptionQuery = mocks.findSubscription.mock.calls[0][0]
    const paymentQuery = mocks.findPayments.mock.calls[0][0]
    expect(subscriptionQuery.select).not.toHaveProperty('providerPlanId')
    expect(subscriptionQuery.select).not.toHaveProperty('environment')
    expect(paymentQuery.select).not.toHaveProperty('providerPaymentId')
    expect(paymentQuery.select).not.toHaveProperty('providerInvoiceId')
    expect(paymentQuery.select).not.toHaveProperty('rawPayload')
  })
})
