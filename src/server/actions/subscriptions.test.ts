import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireBusinessRole: vi.fn(),
  findSubscription: vi.fn(),
  findPayments: vi.fn(),
  startSubscriptionCheckout: vi.fn(),
  requestSubscriptionCancellation: vi.fn(),
  loggerError: vi.fn(),
}))

vi.mock('next/navigation', () => ({ unstable_rethrow: vi.fn() }))

vi.mock('@/server/actions/subscription-billing', () => ({
  startSubscriptionCheckout: (...args: unknown[]) => mocks.startSubscriptionCheckout(...args),
  requestSubscriptionCancellation: (...args: unknown[]) => mocks.requestSubscriptionCancellation(...args),
}))

vi.mock('@/lib/auth/server', () => ({
  requireBusinessRole: (...args: unknown[]) => mocks.requireBusinessRole(...args),
}))

vi.mock('@/lib/logger', () => ({
  logger: { error: (...args: unknown[]) => mocks.loggerError(...args) },
}))

vi.mock('@/lib/db', () => ({
  prisma: {
    businessSubscription: { findFirst: (...args: unknown[]) => mocks.findSubscription(...args) },
    subscriptionPayment: { findMany: (...args: unknown[]) => mocks.findPayments(...args) },
  },
}))

import { UserError } from '@/lib/actions/result'
import { MercadoPagoSubscriptionTransportError } from '@/lib/subscriptions/mercado-pago-client'
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

  it('logs only sanitary observability for an unexpected provider failure', async () => {
    const sentinels = [
      'message-secret-123', 'stack-token-456', 'cause-provider-id-789',
      'code-access-token-abc', 'https://provider.example/checkout/private-id',
    ]
    const error = Object.assign(new Error(sentinels[0], { cause: new Error(sentinels[2]) }), {
      name: 'SecretProviderError',
      stack: sentinels[1],
      code: sentinels[3],
      checkoutUrl: sentinels[4],
    })
    mocks.startSubscriptionCheckout.mockRejectedValue(error)

    const result = await startSubscriptionAction({ error: null }, new FormData())

    expect(mocks.loggerError).toHaveBeenCalledWith(
      'subscription_billing.owner_action_failed',
      'Owner subscription billing action failed.',
      { metadata: { operation: 'start_checkout', classification: 'unexpected' } },
    )
    const serializedLogArguments = JSON.stringify(mocks.loggerError.mock.calls)
    for (const sentinel of sentinels) expect(serializedLogArguments).not.toContain(sentinel)
    expect(serializedLogArguments).not.toContain('SecretProviderError')
    expect(result.error).toBe('Ocurrió un error inesperado. Intenta nuevamente.')
    for (const sentinel of sentinels) expect(result.error).not.toContain(sentinel)
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

  it('records only allowlisted provider outcome and status category', async () => {
    const error = Object.assign(new MercadoPagoSubscriptionTransportError(503), {
      stack: 'provider-token-secret',
      cause: new Error('provider-id-secret'),
      checkoutUrl: 'https://provider.example/private',
    })
    mocks.requestSubscriptionCancellation.mockRejectedValue(error)

    const result = await cancelSubscriptionAction({ error: null }, new FormData())

    expect(result).toEqual({ error: 'Ocurrió un error inesperado. Intenta nuevamente.' })
    expect(mocks.loggerError).toHaveBeenCalledWith(
      'subscription_billing.owner_action_failed',
      'Owner subscription billing action failed.',
      { metadata: {
        operation: 'cancel_renewal',
        classification: 'provider_transport',
        providerOutcome: 'ambiguous',
        statusCategory: '5xx',
      } },
    )
    const logged = JSON.stringify(mocks.loggerError.mock.calls)
    expect(logged).not.toContain('provider-token-secret')
    expect(logged).not.toContain('provider-id-secret')
    expect(logged).not.toContain('provider.example')
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
