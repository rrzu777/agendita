import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireBusinessRole: vi.fn(),
  findSubscription: vi.fn(),
  findPayments: vi.fn(),
  startSubscriptionCheckout: vi.fn(),
  requestSubscriptionCancellation: vi.fn(),
}))

vi.mock('next/navigation', () => ({ unstable_rethrow: vi.fn() }))

vi.mock('@/server/actions/subscription-billing', () => ({
  startSubscriptionCheckout: (...args: unknown[]) => mocks.startSubscriptionCheckout(...args),
  requestSubscriptionCancellation: (...args: unknown[]) => mocks.requestSubscriptionCancellation(...args),
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

import { UserError } from '@/lib/actions/result'
import {
  cancelSubscriptionAction,
  getCurrentSubscription,
  startSubscriptionAction,
} from './subscriptions'

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

describe('owner subscription action state', () => {
  beforeEach(() => vi.resetAllMocks())

  it('returns a recoverable stale eligibility error without provider details', async () => {
    mocks.startSubscriptionCheckout.mockRejectedValue(
      new UserError('El checkout vencido no coincide con el estado actual; reintenta.'),
    )

    const result = await startSubscriptionAction({ error: null }, new FormData())

    expect(result).toEqual({
      error: 'El checkout vencido no coincide con el estado actual; reintenta.',
    })
  })

  it('logs an unexpected provider failure and returns only a generic retryable message', async () => {
    const error = new Error('provider subscription id secret-123 failed')
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.startSubscriptionCheckout.mockRejectedValue(error)

    const result = await startSubscriptionAction({ error: null }, new FormData())

    expect(consoleError).toHaveBeenCalledWith(error)
    expect(result.error).toBe('Ocurrió un error inesperado. Intenta nuevamente.')
    expect(result.error).not.toContain('secret-123')
    consoleError.mockRestore()
  })

  it('allows retry after a recoverable checkout failure', async () => {
    mocks.startSubscriptionCheckout
      .mockRejectedValueOnce(new UserError('El estado cambió; reintenta.'))
      .mockResolvedValueOnce(undefined)

    const failed = await startSubscriptionAction({ error: null }, new FormData())
    const retried = await startSubscriptionAction(failed, new FormData())

    expect(failed.error).toContain('reintenta')
    expect(retried).toEqual({ error: null })
    expect(mocks.startSubscriptionCheckout).toHaveBeenCalledTimes(2)
  })

  it('maps cancellation failures to the same sanitary action state', async () => {
    mocks.requestSubscriptionCancellation.mockRejectedValue(
      new UserError('La suscripción cambió; actualiza la página e intenta nuevamente.'),
    )

    await expect(cancelSubscriptionAction({ error: null }, new FormData())).resolves.toEqual({
      error: 'La suscripción cambió; actualiza la página e intenta nuevamente.',
    })
  })
})
