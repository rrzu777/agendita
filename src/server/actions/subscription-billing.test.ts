import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'

const mocks = vi.hoisted(() => {
  const prisma = {
    businessSubscription: { findFirst: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn() },
    subscriptionPlanMapping: {
      findFirst: vi.fn(), upsert: vi.fn(), updateMany: vi.fn(), update: vi.fn(), deleteMany: vi.fn(),
    },
    subscriptionCheckoutAttempt: {
      findFirst: vi.fn(), create: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn(),
    },
    subscriptionLog: { create: vi.fn() },
    $transaction: vi.fn(),
  }
  return {
    prisma,
    requireBusinessRole: vi.fn(),
    createPlan: vi.fn(), searchPlans: vi.fn(), createSubscription: vi.fn(),
    getSubscription: vi.fn(), cancelSubscription: vi.fn(),
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
    searchPlans: mocks.searchPlans,
    createSubscription: mocks.createSubscription,
    getSubscription: mocks.getSubscription,
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
  updatedAt: new Date('2026-08-11T11:00:00.000Z'),
  plan: { id: 'plan-1', name: 'Plan Pro', priceMonthly: 99_990 },
}
const mapping = {
  id: 'mapping-1', planId: 'plan-1', provider: 'mercado_pago', environment: 'sandbox',
  providerPlanId: 'provider-plan-1', amount: 14_990, currency: 'CLP', isActive: true,
  provisioningToken: null, provisioningLeaseExpiresAt: null, externalReference: null,
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
    mocks.prisma.subscriptionCheckoutAttempt.findFirst.mockResolvedValue(null)
    mocks.prisma.subscriptionCheckoutAttempt.create.mockResolvedValue({ id: 'attempt-1' })
    mocks.prisma.subscriptionCheckoutAttempt.updateMany.mockResolvedValue({ count: 1 })
    mocks.prisma.subscriptionPlanMapping.updateMany.mockResolvedValue({ count: 1 })
    mocks.prisma.subscriptionLog.create.mockResolvedValue({ id: 'log-1' })
    mocks.prisma.businessSubscription.updateMany.mockResolvedValue({ count: 1 })
    mocks.prisma.businessSubscription.findUnique.mockResolvedValue(subscription)
    mocks.searchPlans.mockResolvedValue([])
    mocks.prisma.$transaction.mockImplementation(async (callback) => callback(mocks.prisma))
    mocks.createSubscription.mockImplementation(async (input) => ({
      id: 'provider-subscription-1', status: 'pending',
      providerStatus: 'pending', planId: input.planId,
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
    expect(mocks.prisma.businessSubscription.updateMany).not.toHaveBeenCalled()
    expect(mocks.prisma.subscriptionCheckoutAttempt.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'attempt-1', providerSubscriptionId: null, invalidatedAt: null,
        subscription: { providerSubscriptionId: null },
      },
      data: {
        providerSubscriptionId: 'provider-subscription-1', providerPlanId: 'provider-plan-1',
      },
    })
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
        id: 'provider-subscription-1', status: 'pending', providerStatus: 'pending',
        planId: 'provider-plan-1', externalReference: input.externalReference,
        checkoutUrl: 'https://www.mercadopago.cl/subscriptions/checkout', amount: 14_990,
        currency: 'CLP', frequency: 1, frequencyType: 'months', nextPaymentAt: TRIAL_END,
      }
    })
    await startSubscriptionCheckout()
    expect(order).toEqual(['persist-reference', 'provider-request'])
  })

  it('blocks only a still-open unexpired checkout attempt', async () => {
    mocks.prisma.subscriptionCheckoutAttempt.findFirst.mockResolvedValue({
      id: 'attempt-open', providerSubscriptionId: 'candidate-open', providerPlanId: 'provider-plan-1',
      referenceHash: 'hash', expiresAt: new Date(NOW.getTime() + 1_000), invalidatedAt: null,
    })
    await expect(startSubscriptionCheckout()).rejects.toThrow(/checkout.*proceso/i)
    expect(mocks.getSubscription).not.toHaveBeenCalled()
    expect(mocks.createSubscription).not.toHaveBeenCalled()
  })

  it('cancels a stale pending candidate outside transactions and allows retry', async () => {
    const oldReference = 'old-reference'
    mocks.prisma.subscriptionCheckoutAttempt.findFirst.mockResolvedValue({
      id: 'attempt-old', providerSubscriptionId: 'candidate-old', providerPlanId: 'provider-plan-1',
      referenceHash: createHash('sha256').update(oldReference).digest('hex'),
      expiresAt: new Date(NOW.getTime() - 1_000), invalidatedAt: null,
    })
    mocks.getSubscription.mockResolvedValue({
      id: 'candidate-old', status: 'pending', providerStatus: 'pending', planId: 'provider-plan-1',
      externalReference: oldReference, checkoutUrl: null, amount: 14_990, currency: 'CLP',
      frequency: 1, frequencyType: 'months', nextPaymentAt: null,
    })
    mocks.cancelSubscription.mockResolvedValue({ id: 'candidate-old', status: 'canceled' })

    await startSubscriptionCheckout()

    expect(mocks.getSubscription).toHaveBeenCalledWith('candidate-old')
    expect(mocks.cancelSubscription).toHaveBeenCalledWith('candidate-old')
    expect(mocks.prisma.subscriptionCheckoutAttempt.updateMany).toHaveBeenCalledWith({
      where: { id: 'attempt-old', invalidatedAt: null, expiresAt: { lte: NOW } },
      data: { invalidatedAt: NOW },
    })
    expect(mocks.createSubscription).toHaveBeenCalledTimes(1)
    expect(mocks.prisma.businessSubscription.updateMany).not.toHaveBeenCalled()
  })

  it('cancels and invalidates an external authorization whose reference does not match', async () => {
    mocks.createSubscription.mockResolvedValue({
      id: 'provider-subscription-wrong', status: 'pending', providerStatus: 'pending',
      planId: 'provider-plan-1', externalReference: 'wrong-reference',
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

  it('cancels a new pending candidate when another authorization wins the local race', async () => {
    mocks.prisma.subscriptionCheckoutAttempt.updateMany
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValue({ count: 1 })
    mocks.cancelSubscription.mockResolvedValue({ id: 'provider-subscription-1', status: 'canceled' })

    await expect(startSubscriptionCheckout()).rejects.toThrow(/checkout ya no está vigente/i)

    expect(mocks.cancelSubscription).toHaveBeenCalledWith('provider-subscription-1')
    expect(mocks.prisma.businessSubscription.updateMany).not.toHaveBeenCalled()
    expect(mocks.redirect).not.toHaveBeenCalled()
  })

  it('adopts an authorized stale candidate exactly once without creating another', async () => {
    const oldReference = 'authorized-reference'
    mocks.prisma.subscriptionCheckoutAttempt.findFirst.mockResolvedValue({
      id: 'attempt-authorized', providerSubscriptionId: 'candidate-authorized',
      providerPlanId: 'provider-plan-1',
      referenceHash: createHash('sha256').update(oldReference).digest('hex'),
      expiresAt: new Date(NOW.getTime() - 1_000), invalidatedAt: null,
    })
    mocks.getSubscription.mockResolvedValue({
      id: 'candidate-authorized', status: 'active', providerStatus: 'authorized',
      planId: 'provider-plan-1', externalReference: oldReference, checkoutUrl: null,
      amount: 14_990, currency: 'CLP', frequency: 1, frequencyType: 'months', nextPaymentAt: TRIAL_END,
    })

    await startSubscriptionCheckout()

    expect(mocks.createSubscription).not.toHaveBeenCalled()
    expect(mocks.cancelSubscription).not.toHaveBeenCalled()
    expect(mocks.prisma.businessSubscription.updateMany).toHaveBeenCalledTimes(1)
    expect(mocks.prisma.subscriptionLog.create).toHaveBeenCalledTimes(1)
    expect(mocks.prisma.subscriptionCheckoutAttempt.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'attempt-authorized', providerSubscriptionId: 'candidate-authorized',
        providerPlanId: 'provider-plan-1', invalidatedAt: null,
      },
      data: { invalidatedAt: NOW },
    })
  })

  it('treats a concurrent adoption of the same authorized candidate as idempotent', async () => {
    const oldReference = 'authorized-reference'
    mocks.prisma.subscriptionCheckoutAttempt.findFirst.mockResolvedValue({
      id: 'attempt-authorized', providerSubscriptionId: 'candidate-authorized',
      providerPlanId: 'provider-plan-1',
      referenceHash: createHash('sha256').update(oldReference).digest('hex'),
      expiresAt: new Date(NOW.getTime() - 1_000), invalidatedAt: null,
    })
    mocks.getSubscription.mockResolvedValue({
      id: 'candidate-authorized', status: 'active', providerStatus: 'authorized',
      planId: 'provider-plan-1', externalReference: oldReference, checkoutUrl: null,
      amount: 14_990, currency: 'CLP', frequency: 1, frequencyType: 'months', nextPaymentAt: TRIAL_END,
    })
    mocks.prisma.businessSubscription.updateMany.mockResolvedValue({ count: 0 })
    mocks.prisma.businessSubscription.findUnique.mockResolvedValue({
      ...subscription, providerSubscriptionId: 'candidate-authorized',
    })

    await startSubscriptionCheckout()

    expect(mocks.prisma.subscriptionLog.create).not.toHaveBeenCalled()
    expect(mocks.createSubscription).not.toHaveBeenCalled()
    expect(mocks.redirect).toHaveBeenCalledWith('/dashboard/billing?subscription=active')
  })

  it('provisions one price-version mapping and uses a DB snapshot, not Plan.priceMonthly', async () => {
    mocks.prisma.subscriptionPlanMapping.findFirst.mockResolvedValue(null)
    mocks.prisma.subscriptionPlanMapping.upsert.mockImplementation(async ({ create }) => ({
      ...mapping, id: 'mapping-new', providerPlanId: null, isActive: false,
      provisioningToken: create.provisioningToken,
      provisioningLeaseExpiresAt: create.provisioningLeaseExpiresAt,
      externalReference: create.externalReference,
    }))
    mocks.createPlan.mockImplementation(async (input) => ({
      id: 'provider-plan-new', status: 'active', externalReference: input.externalReference,
      amount: 14_990, currency: 'CLP', frequency: 1, frequencyType: 'months',
    }))
    await startSubscriptionCheckout()
    expect(mocks.createPlan).toHaveBeenCalledWith({
      name: 'Plan Pro', amount: 14_990,
      externalReference: expect.stringMatching(/^agendita_plan_[0-9a-f-]{36}$/),
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

  it('recovers an externally-created plan after DB failure and a stale lease without duplication', async () => {
    mocks.prisma.subscriptionPlanMapping.findFirst.mockResolvedValue(null)
    let reserved: {
      id: string; planId: string; provider: 'mercado_pago'; environment: 'sandbox';
      providerPlanId: null; amount: number; currency: string; isActive: false;
      provisioningToken: string; provisioningLeaseExpiresAt: Date; externalReference: string;
    } | undefined
    mocks.prisma.subscriptionPlanMapping.upsert.mockImplementation(async ({ create }) => ({
      ...mapping, id: 'mapping-new', providerPlanId: null, isActive: false,
      provisioningToken: create.provisioningToken,
      provisioningLeaseExpiresAt: create.provisioningLeaseExpiresAt,
      externalReference: create.externalReference,
    }))
    mocks.prisma.subscriptionPlanMapping.upsert.mockImplementation(async ({ create }) => {
      reserved ??= {
        id: create.id, planId: 'plan-1', provider: 'mercado_pago', environment: 'sandbox',
        amount: 14_990, currency: 'CLP', providerPlanId: null, isActive: false,
        provisioningToken: create.provisioningToken,
        provisioningLeaseExpiresAt: create.provisioningLeaseExpiresAt,
        externalReference: create.externalReference,
      }
      return reserved
    })
    const externalPlan = {
      id: 'provider-plan-new', status: 'active', amount: 14_990, currency: 'CLP' as const,
      frequency: 1 as const, frequencyType: 'months' as const, externalReference: '',
    }
    mocks.createPlan.mockImplementation(async (input) => ({ ...externalPlan, externalReference: input.externalReference }))
    mocks.prisma.subscriptionPlanMapping.updateMany
      .mockRejectedValueOnce(new Error('database unavailable'))

    await expect(startSubscriptionCheckout()).rejects.toThrow(/database unavailable/i)
    expect(mocks.createPlan).toHaveBeenCalledTimes(1)

    vi.setSystemTime(new Date(NOW.getTime() + 6 * 60 * 1_000))
    reserved!.provisioningLeaseExpiresAt = new Date(NOW.getTime() + 5 * 60 * 1_000)
    mocks.searchPlans.mockResolvedValue([{ ...externalPlan, externalReference: reserved!.externalReference }])
    mocks.prisma.subscriptionPlanMapping.updateMany.mockResolvedValue({ count: 1 })
    await startSubscriptionCheckout()

    expect(mocks.createPlan).toHaveBeenCalledTimes(1)
    expect(mocks.searchPlans).toHaveBeenLastCalledWith(reserved!.externalReference)
    expect(mocks.createSubscription).toHaveBeenCalledTimes(1)
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

  it('keeps cancellation available when the creation kill switch is disabled', async () => {
    process.env.MP_SUBSCRIPTIONS_ENABLED = 'false'
    mocks.prisma.businessSubscription.findFirst.mockResolvedValue({
      ...subscription, status: 'active', provider: 'mercado_pago', environment: 'sandbox',
      providerPlanId: 'provider-plan-1', providerSubscriptionId: 'provider-subscription-1',
    })
    mocks.cancelSubscription.mockResolvedValue({ id: 'provider-subscription-1', status: 'canceled' })
    mocks.applySubscriptionTransition.mockResolvedValue({ applied: true, status: 'active' })

    await requestSubscriptionCancellation()

    expect(mocks.cancelSubscription).toHaveBeenCalledWith('provider-subscription-1')
    expect(mocks.applySubscriptionTransition).toHaveBeenCalledTimes(1)
  })
})
