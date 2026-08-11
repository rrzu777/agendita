import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const prisma = {
    businessSubscription: { findFirst: vi.fn(), updateMany: vi.fn() },
    subscriptionPlanMapping: {
      findFirst: vi.fn(), upsert: vi.fn(), updateMany: vi.fn(), update: vi.fn(), deleteMany: vi.fn(),
    },
    subscriptionCheckoutAttempt: { create: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn() },
    $transaction: vi.fn(),
  }
  return {
    prisma,
    requireBusinessRole: vi.fn(),
    createPlan: vi.fn(), createSubscription: vi.fn(), cancelSubscription: vi.fn(),
    applySubscriptionTransition: vi.fn(), redirect: vi.fn(),
  }
})

vi.mock('@/lib/db', () => ({ prisma: mocks.prisma }))
vi.mock('@/lib/auth/server', () => ({
  requireBusinessRole: (...args: unknown[]) => mocks.requireBusinessRole(...args),
}))
vi.mock('@/lib/subscriptions/mercado-pago-client', () => ({
  createMpSubscriptionClient: vi.fn(() => ({
    createPlan: mocks.createPlan,
    createSubscription: mocks.createSubscription,
    cancelSubscription: mocks.cancelSubscription,
  })),
}))
vi.mock('@/lib/subscriptions/transition', () => ({
  applySubscriptionTransition: (...args: unknown[]) => mocks.applySubscriptionTransition(...args),
}))
vi.mock('next/navigation', () => ({ redirect: (...args: unknown[]) => mocks.redirect(...args) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { requestSubscriptionCancellation, startSubscriptionCheckout } from './subscription-billing'

const NOW = new Date('2026-08-11T12:00:00.000Z')
const TRIAL_END = new Date('2026-08-14T12:00:00.000Z')
const subscription = {
  id: 'subscription-1', businessId: 'business-1', planId: 'plan-1', status: 'trialing',
  interval: 'monthly', amount: 14_990, currency: 'CLP', provider: 'manual', environment: null,
  providerPlanId: null, providerSubscriptionId: null, trialEndAt: TRIAL_END,
  complimentaryUntil: null, billingEnabled: true, cancelAtPeriodEnd: false,
  plan: { id: 'plan-1', name: 'Plan Pro', priceMonthly: 99_990 },
}
const mapping = {
  id: 'mapping-1', planId: 'plan-1', provider: 'mercado_pago', environment: 'sandbox',
  providerPlanId: 'provider-plan-1', amount: 14_990, currency: 'CLP', isActive: true,
  provisioningToken: null,
}

describe('subscription billing actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.setSystemTime(NOW)
    process.env.MP_SUBSCRIPTIONS_ENABLED = 'true'
    process.env.MERCADO_PAGO_ENVIRONMENT = 'sandbox'
    process.env.MERCADO_PAGO_SANDBOX_ACCESS_TOKEN = 'test-token'
    process.env.MERCADO_PAGO_SANDBOX_WEBHOOK_SECRET = 'test-secret'
    process.env.MERCADO_PAGO_SANDBOX_SUBSCRIPTIONS_CALLBACK_URL =
      'https://app.example.com/api/mercado-pago/subscriptions/callback'
    mocks.requireBusinessRole.mockResolvedValue({
      businessId: 'business-1', user: { id: 'user-1', email: 'owner@example.com' }, role: 'owner',
    })
    mocks.prisma.businessSubscription.findFirst.mockResolvedValue(subscription)
    mocks.prisma.subscriptionPlanMapping.findFirst.mockResolvedValue(mapping)
    mocks.prisma.subscriptionCheckoutAttempt.create.mockResolvedValue({ id: 'attempt-1' })
    mocks.prisma.subscriptionCheckoutAttempt.updateMany.mockResolvedValue({ count: 1 })
    mocks.prisma.businessSubscription.updateMany.mockResolvedValue({ count: 1 })
    mocks.prisma.$transaction.mockImplementation(async (callback) => callback(mocks.prisma))
    mocks.createSubscription.mockImplementation(async (input) => ({
      id: 'provider-subscription-1', status: 'pending',
      externalReference: input.externalReference,
      checkoutUrl: 'https://www.mercadopago.cl/subscriptions/checkout?id=opaque',
      amount: 14_990, currency: 'CLP', frequency: 1, frequencyType: 'months',
      nextPaymentAt: TRIAL_END,
    }))
    mocks.redirect.mockImplementation(() => undefined)
  })

  it('fails closed when recurring subscriptions are disabled', async () => {
    process.env.MP_SUBSCRIPTIONS_ENABLED = 'false'
    await expect(startSubscriptionCheckout()).rejects.toThrow(/deshabilitada/i)
    expect(mocks.prisma.businessSubscription.findFirst).not.toHaveBeenCalled()
    expect(mocks.createSubscription).not.toHaveBeenCalled()
  })

  it('rejects a business outside the persisted rollout', async () => {
    mocks.prisma.businessSubscription.findFirst.mockResolvedValue({ ...subscription, billingEnabled: false })
    await expect(startSubscriptionCheckout()).rejects.toThrow(/habilitad[oa].*negocio/i)
    expect(mocks.createSubscription).not.toHaveBeenCalled()
  })

  it('rejects a current complimentary period without asking for a payment method', async () => {
    mocks.prisma.businessSubscription.findFirst.mockResolvedValue({
      ...subscription, complimentaryUntil: new Date('2026-09-01T00:00:00.000Z'),
    })
    await expect(startSubscriptionCheckout()).rejects.toThrow(/exenci/i)
    expect(mocks.createSubscription).not.toHaveBeenCalled()
  })

  it('rejects a subscription whose local plan cannot be mapped', async () => {
    mocks.prisma.businessSubscription.findFirst.mockResolvedValue({ ...subscription, plan: null })
    await expect(startSubscriptionCheckout()).rejects.toThrow(/plan/i)
    expect(mocks.createPlan).not.toHaveBeenCalled()
  })

  it('rejects a second external authorization', async () => {
    mocks.prisma.businessSubscription.findFirst.mockResolvedValue({
      ...subscription, provider: 'mercado_pago', environment: 'sandbox',
      providerPlanId: 'provider-plan-1', providerSubscriptionId: 'provider-subscription-existing',
    })
    await expect(startSubscriptionCheckout()).rejects.toThrow(/ya.*suscripci/i)
    expect(mocks.createSubscription).not.toHaveBeenCalled()
  })

  it('delegates owner/admin authorization instead of accepting a tenant from form data', async () => {
    mocks.requireBusinessRole.mockRejectedValue(new Error('No tienes permisos'))
    await expect(startSubscriptionCheckout()).rejects.toThrow(/permisos/i)
    expect(mocks.requireBusinessRole).toHaveBeenCalledWith(['owner', 'admin'])
    expect(mocks.prisma.businessSubscription.findFirst).not.toHaveBeenCalled()
  })

  it.each([
    ['a trial close to expiry', subscription],
    ['past due without authorization', { ...subscription, status: 'past_due', trialEndAt: null }],
  ])('starts hosted checkout for %s using only the persisted snapshot', async (_name, eligible) => {
    mocks.prisma.businessSubscription.findFirst.mockResolvedValue(eligible)
    await startSubscriptionCheckout()
    expect(mocks.createSubscription).toHaveBeenCalledWith(expect.objectContaining({
      planId: 'provider-plan-1', amount: 14_990, payerEmail: 'owner@example.com',
      startDate: eligible.trialEndAt ?? NOW,
      externalReference: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
    }))
    const createAttempt = mocks.prisma.subscriptionCheckoutAttempt.create.mock.calls[0][0]
    expect(createAttempt.data).toMatchObject({
      businessId: 'business-1', subscriptionId: 'subscription-1', environment: 'sandbox',
    })
    expect(createAttempt.data.referenceHash).toMatch(/^[a-f0-9]{64}$/)
    expect(createAttempt.data).not.toHaveProperty('reference')
    expect(mocks.redirect).toHaveBeenCalledWith(
      'https://www.mercadopago.cl/subscriptions/checkout?id=opaque',
    )
  })

  it('persists the one-time reference before the provider request and does no network call in a transaction', async () => {
    const order: string[] = []
    mocks.prisma.subscriptionCheckoutAttempt.create.mockImplementation(async () => {
      order.push('persist-reference')
      return { id: 'attempt-1' }
    })
    mocks.createSubscription.mockImplementation(async (input) => {
      order.push('provider-request')
      return {
        id: 'provider-subscription-1', status: 'pending', externalReference: input.externalReference,
        checkoutUrl: 'https://www.mercadopago.cl/subscriptions/checkout', amount: 14_990,
        currency: 'CLP', frequency: 1, frequencyType: 'months', nextPaymentAt: TRIAL_END,
      }
    })
    await startSubscriptionCheckout()
    expect(order).toEqual(['persist-reference', 'provider-request'])
  })

  it('expires abandoned attempts before reserving the next checkout', async () => {
    await startSubscriptionCheckout()

    expect(mocks.prisma.subscriptionCheckoutAttempt.updateMany).toHaveBeenCalledWith({
      where: {
        subscriptionId: 'subscription-1', environment: 'sandbox',
        consumedAt: null, invalidatedAt: null, expiresAt: { lte: NOW },
      },
      data: { invalidatedAt: NOW },
    })
    const expireOrder = mocks.prisma.subscriptionCheckoutAttempt.updateMany.mock.invocationCallOrder[0]
    const reserveOrder = mocks.prisma.subscriptionCheckoutAttempt.create.mock.invocationCallOrder[0]
    const providerOrder = mocks.createSubscription.mock.invocationCallOrder[0]
    expect(expireOrder).toBeLessThan(reserveOrder)
    expect(reserveOrder).toBeLessThan(providerOrder)
  })

  it('cancels and invalidates an external authorization whose reference does not match', async () => {
    mocks.createSubscription.mockResolvedValue({
      id: 'provider-subscription-wrong', status: 'pending', externalReference: 'wrong-reference',
      checkoutUrl: 'https://www.mercadopago.cl/subscriptions/checkout', amount: 14_990,
      currency: 'CLP', frequency: 1, frequencyType: 'months', nextPaymentAt: TRIAL_END,
    })

    await expect(startSubscriptionCheckout()).rejects.toThrow(/referencia/i)

    expect(mocks.cancelSubscription).toHaveBeenCalledWith('provider-subscription-wrong')
    expect(mocks.prisma.subscriptionCheckoutAttempt.updateMany).toHaveBeenCalledWith({
      where: { id: 'attempt-1', invalidatedAt: null },
      data: { invalidatedAt: expect.any(Date) },
    })
  })

  it('keeps the local CAS conflict as the primary error when compensation also fails', async () => {
    mocks.prisma.businessSubscription.updateMany.mockResolvedValue({ count: 0 })
    mocks.cancelSubscription.mockRejectedValue(new Error('provider cancellation unavailable'))

    await expect(startSubscriptionCheckout()).rejects.toThrow(/cambió durante el checkout/i)

    expect(mocks.cancelSubscription).toHaveBeenCalledWith('provider-subscription-1')
    expect(mocks.prisma.subscriptionCheckoutAttempt.updateMany).toHaveBeenCalledWith({
      where: { id: 'attempt-1', invalidatedAt: null },
      data: { invalidatedAt: expect.any(Date) },
    })
  })

  it('provisions one price-version mapping and uses a DB snapshot, not Plan.priceMonthly', async () => {
    mocks.prisma.subscriptionPlanMapping.findFirst.mockResolvedValue(null)
    mocks.prisma.subscriptionPlanMapping.upsert.mockImplementation(async ({ create }) => ({
      ...mapping, id: 'mapping-new', providerPlanId: null, isActive: false,
      provisioningToken: create.provisioningToken,
    }))
    mocks.createPlan.mockResolvedValue({ id: 'provider-plan-new', status: 'active' })
    mocks.prisma.subscriptionPlanMapping.update.mockResolvedValue({
      ...mapping, id: 'mapping-new', providerPlanId: 'provider-plan-new',
    })
    await startSubscriptionCheckout()
    expect(mocks.createPlan).toHaveBeenCalledWith({
      name: 'Plan Pro', amount: 14_990,
      externalReference: expect.stringMatching(/^plan_[A-Za-z0-9_-]{43}$/),
    })
    expect(mocks.prisma.subscriptionPlanMapping.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { planId_provider_environment_amount_currency: {
        planId: 'plan-1', provider: 'mercado_pago', environment: 'sandbox',
        amount: 14_990, currency: 'CLP',
      } },
    }))
  })

  it('recovers a uniqueness race without creating a second external plan', async () => {
    mocks.prisma.subscriptionPlanMapping.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(mapping)
    mocks.prisma.subscriptionPlanMapping.upsert.mockRejectedValue({ code: 'P2002' })
    await startSubscriptionCheckout()
    expect(mocks.createPlan).not.toHaveBeenCalled()
    expect(mocks.createSubscription).toHaveBeenCalledWith(expect.objectContaining({ planId: 'provider-plan-1' }))
  })

  it('does not release the provisioning lease after the provider created a plan but persistence failed', async () => {
    mocks.prisma.subscriptionPlanMapping.findFirst.mockResolvedValue(null)
    mocks.prisma.subscriptionPlanMapping.upsert.mockImplementation(async ({ create }) => ({
      ...mapping, id: 'mapping-new', providerPlanId: null, isActive: false,
      provisioningToken: create.provisioningToken,
    }))
    mocks.createPlan.mockResolvedValue({ id: 'provider-plan-new', status: 'active' })
    mocks.prisma.subscriptionPlanMapping.update.mockRejectedValue(new Error('database unavailable'))

    await expect(startSubscriptionCheckout()).rejects.toThrow(/database unavailable/i)

    expect(mocks.createPlan).toHaveBeenCalledTimes(1)
    expect(mocks.prisma.subscriptionPlanMapping.deleteMany).not.toHaveBeenCalled()
    expect(mocks.createSubscription).not.toHaveBeenCalled()
  })

  it('requests provider cancellation before the atomic local period-end transition', async () => {
    mocks.prisma.businessSubscription.findFirst.mockResolvedValue({
      ...subscription, status: 'active', provider: 'mercado_pago', environment: 'sandbox',
      providerPlanId: 'provider-plan-1', providerSubscriptionId: 'provider-subscription-1',
    })
    const order: string[] = []
    mocks.cancelSubscription.mockImplementation(async () => {
      order.push('provider')
      return { id: 'provider-subscription-1', status: 'canceled' }
    })
    mocks.applySubscriptionTransition.mockImplementation(async () => {
      order.push('local')
      return { applied: true, status: 'active' }
    })
    await requestSubscriptionCancellation()
    expect(order).toEqual(['provider', 'local'])
    expect(mocks.applySubscriptionTransition).toHaveBeenCalledWith(mocks.prisma, {
      businessId: 'business-1', command: { type: 'provider_cancelled', occurredAt: expect.any(Date) },
    })
  })
})
