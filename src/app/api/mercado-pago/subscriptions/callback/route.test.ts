import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const prisma = {
    subscriptionCheckoutAttempt: { findFirst: vi.fn(), updateMany: vi.fn() },
    businessSubscription: { update: vi.fn(), updateMany: vi.fn() },
    $transaction: vi.fn(),
  }
  return { prisma, getSubscription: vi.fn() }
})

vi.mock('@/lib/db', () => ({ prisma: mocks.prisma }))
vi.mock('@/lib/subscriptions/mercado-pago-client', () => ({
  createMpSubscriptionClient: vi.fn(() => ({ getSubscription: mocks.getSubscription })),
}))

import { createHash } from 'node:crypto'
import { GET } from './route'

const REFERENCE = 'L6fgfMZWD7eJX9Q7PHQ2m4CnxWAQdxfhUc8fI4C9A7Y'
const hash = createHash('sha256').update(REFERENCE).digest('hex')
const attempt = {
  id: 'attempt-1', businessId: 'business-1', subscriptionId: 'subscription-1',
  environment: 'sandbox', referenceHash: hash,
  providerSubscriptionId: 'provider-subscription-1',
  providerPlanId: 'provider-plan-1',
  expiresAt: new Date('2026-08-11T13:00:00.000Z'), consumedAt: null,
  subscription: { amount: 14_990, currency: 'CLP' },
}

function request(query: string) {
  return new Request(`https://app.example.com/api/mercado-pago/subscriptions/callback?${query}`)
}

describe('Mercado Pago subscriptions callback', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.setSystemTime(new Date('2026-08-11T12:00:00.000Z'))
    process.env.MP_SUBSCRIPTIONS_ENABLED = 'true'
    process.env.MERCADO_PAGO_ENVIRONMENT = 'sandbox'
    process.env.MERCADO_PAGO_SANDBOX_ACCESS_TOKEN = 'test-token'
    process.env.MERCADO_PAGO_SANDBOX_WEBHOOK_SECRET = 'test-secret'
    process.env.MERCADO_PAGO_SANDBOX_SUBSCRIPTIONS_CALLBACK_URL =
      'https://app.example.com/api/mercado-pago/subscriptions/callback'
    mocks.prisma.subscriptionCheckoutAttempt.findFirst.mockResolvedValue(attempt)
    mocks.prisma.subscriptionCheckoutAttempt.updateMany.mockResolvedValue({ count: 1 })
    mocks.prisma.$transaction.mockImplementation(async (callback) => callback(mocks.prisma))
    mocks.getSubscription.mockResolvedValue({
      id: 'provider-subscription-1', status: 'pending', externalReference: REFERENCE,
      providerStatus: 'pending', planId: 'provider-plan-1',
      checkoutUrl: null, amount: 14_990, currency: 'CLP', frequency: 1,
      frequencyType: 'months', nextPaymentAt: null,
    })
  })

  it('rejects missing, unknown, expired, or replayed one-time state without provider lookup', async () => {
    mocks.prisma.subscriptionCheckoutAttempt.findFirst.mockResolvedValue(null)
    const response = await GET(request('status=authorized'))
    expect(response.headers.get('location')).toBe(
      'https://app.example.com/dashboard/billing?subscription=failed',
    )
    expect(mocks.getSubscription).not.toHaveBeenCalled()
    expect(mocks.prisma.businessSubscription.update).not.toHaveBeenCalled()
    expect(mocks.prisma.businessSubscription.updateMany).not.toHaveBeenCalled()
  })

  it('binds state to the configured environment and consumes it with a CAS before lookup', async () => {
    const response = await GET(request(`state=${encodeURIComponent(REFERENCE)}`))
    expect(mocks.prisma.subscriptionCheckoutAttempt.findFirst).toHaveBeenCalledWith({
      where: {
        referenceHash: hash, environment: 'sandbox', consumedAt: null,
        expiresAt: { gt: expect.any(Date) },
      },
      include: { subscription: { select: { amount: true, currency: true } } },
    })
    expect(mocks.prisma.subscriptionCheckoutAttempt.updateMany).toHaveBeenCalledWith({
      where: { id: 'attempt-1', consumedAt: null }, data: { consumedAt: expect.any(Date) },
    })
    expect(mocks.getSubscription).toHaveBeenCalledWith('provider-subscription-1')
    expect(response.headers.get('location')).toContain('subscription=processing')
  })

  it('treats an authorized-looking query as non-authoritative and trusts provider lookup only', async () => {
    const response = await GET(request(
      `state=${encodeURIComponent(REFERENCE)}&status=authorized&preapproval_id=attacker-id`,
    ))
    expect(mocks.getSubscription).toHaveBeenCalledWith('provider-subscription-1')
    expect(response.headers.get('location')).toContain('subscription=processing')
    expect(mocks.prisma.businessSubscription.update).not.toHaveBeenCalled()
    expect(mocks.prisma.businessSubscription.updateMany).not.toHaveBeenCalled()
  })

  it('shows active provisionally only after exact provider/reference/amount validation', async () => {
    mocks.getSubscription.mockResolvedValue({
      id: 'provider-subscription-1', status: 'active', externalReference: REFERENCE,
      providerStatus: 'authorized', planId: 'provider-plan-1',
      checkoutUrl: null, amount: 14_990, currency: 'CLP', frequency: 1,
      frequencyType: 'months', nextPaymentAt: new Date('2026-09-14T12:00:00.000Z'),
    })
    const response = await GET(request(`external_reference=${encodeURIComponent(REFERENCE)}`))
    expect(response.headers.get('location')).toContain('subscription=active')
    expect(mocks.prisma.businessSubscription.update).not.toHaveBeenCalled()
    expect(mocks.prisma.businessSubscription.updateMany).not.toHaveBeenCalled()
  })

  it.each([
    ['wrong reference', { externalReference: 'other-reference' }],
    ['wrong amount', { amount: 1 }],
    ['wrong currency', { currency: 'USD' }],
    ['wrong provider id', { id: 'provider-subscription-other' }],
  ])('fails closed for %s and never activates locally', async (_name, override) => {
    mocks.getSubscription.mockResolvedValue({
      id: 'provider-subscription-1', status: 'active', externalReference: REFERENCE,
      providerStatus: 'authorized', planId: 'provider-plan-1',
      checkoutUrl: null, amount: 14_990, currency: 'CLP', frequency: 1,
      frequencyType: 'months', nextPaymentAt: null, ...override,
    })
    const response = await GET(request(`state=${encodeURIComponent(REFERENCE)}`))
    expect(response.headers.get('location')).toContain('subscription=failed')
    expect(mocks.prisma.businessSubscription.update).not.toHaveBeenCalled()
    expect(mocks.prisma.businessSubscription.updateMany).not.toHaveBeenCalled()
  })

  it('makes concurrent replay lose the consume CAS and skips provider lookup', async () => {
    mocks.prisma.subscriptionCheckoutAttempt.updateMany.mockResolvedValue({ count: 0 })
    const response = await GET(request(`state=${encodeURIComponent(REFERENCE)}`))
    expect(mocks.getSubscription).not.toHaveBeenCalled()
    expect(response.headers.get('location')).toContain('subscription=failed')
  })
})
