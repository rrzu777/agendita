import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requirePlatformAdminUser: vi.fn(),
  reconcileSubscription: vi.fn(),
  revalidatePath: vi.fn(),
  tx: {
    plan: { findUnique: vi.fn() },
    businessSubscription: { findFirst: vi.fn(), updateMany: vi.fn() },
    business: { update: vi.fn() },
    subscriptionLog: { create: vi.fn() },
  },
  prisma: {
    $transaction: vi.fn(),
    businessSubscription: { findFirst: vi.fn() },
  },
}))

vi.mock('@/lib/auth/user', () => ({
  requirePlatformAdminUser: (...args: unknown[]) => mocks.requirePlatformAdminUser(...args),
}))
vi.mock('@/lib/db', () => ({ prisma: mocks.prisma }))
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock('@/lib/subscriptions/reconciliation', () => ({
  reconcileSubscription: (...args: unknown[]) => mocks.reconcileSubscription(...args),
}))

const subscription = {
  id: 'sub-1',
  businessId: 'biz-1',
  planId: 'plan-old',
  status: 'trialing',
  trialDays: 30,
  graceDays: 7,
  billingEnabled: false,
  complimentaryUntil: null,
  complimentaryReason: null,
  provider: 'manual',
  environment: null,
  providerSubscriptionId: null,
  updatedAt: new Date('2026-08-10T00:00:00.000Z'),
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requirePlatformAdminUser.mockResolvedValue({ id: 'admin-1', email: 'admin@agendita.cl' })
  mocks.prisma.$transaction.mockImplementation(async (fn: (tx: typeof mocks.tx) => unknown) => fn(mocks.tx))
  mocks.tx.businessSubscription.findFirst.mockResolvedValue(subscription)
  mocks.tx.businessSubscription.updateMany.mockResolvedValue({ count: 1 })
  mocks.tx.plan.findUnique.mockResolvedValue({ id: 'plan-pro', name: 'Pro', priceMonthly: 14_990 })
  mocks.tx.business.update.mockResolvedValue({})
  mocks.tx.subscriptionLog.create.mockResolvedValue({ id: 'log-1' })
})

describe('recurring billing admin authorization', () => {
  it('rejects every action before reading or mutating billing data when user is not platform admin', async () => {
    mocks.requirePlatformAdminUser.mockRejectedValue(new Error('Sin permisos'))
    const actions = await import('./admin')

    await expect(actions.adminSetComplimentaryPeriod('biz-1', new Date('2026-09-01'), 'familia'))
      .rejects.toThrow('Sin permisos')
    await expect(actions.adminClearComplimentaryPeriod('biz-1', 'fin de exención'))
      .rejects.toThrow('Sin permisos')
    await expect(actions.adminConfigureBilling('biz-1', {
      planId: 'plan-pro', trialDays: 30, graceDays: 7, billingEnabled: true,
    })).rejects.toThrow('Sin permisos')
    await expect(actions.adminReconcileSubscription('biz-1')).rejects.toThrow('Sin permisos')

    expect(mocks.prisma.$transaction).not.toHaveBeenCalled()
    expect(mocks.reconcileSubscription).not.toHaveBeenCalled()
  }, 15_000)
})

describe('adminSetComplimentaryPeriod', () => {
  it('requires a future date and a non-empty reason', async () => {
    const { adminSetComplimentaryPeriod } = await import('./admin')
    await expect(adminSetComplimentaryPeriod('biz-1', new Date(0), 'familia'))
      .rejects.toThrow(/futura/i)
    await expect(adminSetComplimentaryPeriod('biz-1', new Date('2099-01-01'), '   '))
      .rejects.toThrow(/motivo/i)
  })

  it('stores the exemption and actor in one audited transaction', async () => {
    const until = new Date('2099-01-01T00:00:00.000Z')
    const { adminSetComplimentaryPeriod } = await import('./admin')
    await adminSetComplimentaryPeriod('biz-1', until, 'Family & friends')

    expect(mocks.tx.businessSubscription.updateMany).toHaveBeenCalledWith({
      where: { id: 'sub-1', updatedAt: subscription.updatedAt },
      data: { complimentaryUntil: until, complimentaryReason: 'Family & friends' },
    })
    expect(mocks.tx.subscriptionLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      businessId: 'biz-1', action: 'complimentary_period_set',
      adminUserId: 'admin-1', adminEmail: 'admin@agendita.cl', notes: 'Family & friends',
    }) })
  })

  it('does not pretend to exempt a subscription that can still charge at the provider', async () => {
    mocks.tx.businessSubscription.findFirst.mockResolvedValue({
      ...subscription,
      provider: 'mercado_pago',
      environment: 'sandbox',
      providerSubscriptionId: 'authorized-1',
    })
    const { adminSetComplimentaryPeriod } = await import('./admin')
    await expect(adminSetComplimentaryPeriod('biz-1', new Date('2099-01-01'), 'familia'))
      .rejects.toThrow(/autorización/i)
    expect(mocks.tx.businessSubscription.updateMany).not.toHaveBeenCalled()
  })
})

describe('adminClearComplimentaryPeriod', () => {
  it('requires a reason and only clears local fields without charging or creating checkout', async () => {
    const { adminClearComplimentaryPeriod } = await import('./admin')
    await expect(adminClearComplimentaryPeriod('biz-1', '')).rejects.toThrow(/motivo/i)
    await adminClearComplimentaryPeriod('biz-1', 'Terminó beneficio')

    expect(mocks.tx.businessSubscription.updateMany).toHaveBeenCalledWith({
      where: { id: 'sub-1', updatedAt: subscription.updatedAt },
      data: { complimentaryUntil: null, complimentaryReason: null },
    })
    expect(mocks.reconcileSubscription).not.toHaveBeenCalled()
  })
})

describe('adminConfigureBilling', () => {
  it.each([
    [{ trialDays: -1, graceDays: 7 }, /trial/i],
    [{ trialDays: 366, graceDays: 7 }, /trial/i],
    [{ trialDays: 30, graceDays: -1 }, /gracia/i],
    [{ trialDays: 30, graceDays: 31 }, /gracia/i],
    [{ trialDays: 1.5, graceDays: 7 }, /trial/i],
  ])('rejects invalid integer limits %#', async (partial, message) => {
    const { adminConfigureBilling } = await import('./admin')
    await expect(adminConfigureBilling('biz-1', {
      planId: 'plan-pro', billingEnabled: true, ...partial,
    })).rejects.toThrow(message)
  })

  it('atomically snapshots the monthly plan and enables rollout without charging', async () => {
    const { adminConfigureBilling } = await import('./admin')
    await adminConfigureBilling('biz-1', {
      planId: 'plan-pro', trialDays: 45, graceDays: 10, billingEnabled: true,
    })

    expect(mocks.tx.businessSubscription.updateMany).toHaveBeenCalledWith({
      where: { id: 'sub-1', updatedAt: subscription.updatedAt },
      data: { planId: 'plan-pro', amount: 14_990, trialDays: 45, graceDays: 10, billingEnabled: true },
    })
    expect(mocks.tx.business.update).toHaveBeenCalledWith({
      where: { id: 'biz-1' }, data: { planId: 'plan-pro' },
    })
    expect(mocks.reconcileSubscription).not.toHaveBeenCalled()
  })

  it('rejects changing the contracted plan behind an existing provider authorization', async () => {
    mocks.tx.businessSubscription.findFirst.mockResolvedValue({
      ...subscription,
      provider: 'mercado_pago',
      environment: 'production',
      providerSubscriptionId: 'authorized-1',
    })
    const { adminConfigureBilling } = await import('./admin')
    await expect(adminConfigureBilling('biz-1', {
      planId: 'plan-pro', trialDays: 30, graceDays: 7, billingEnabled: true,
    })).rejects.toThrow(/plan contratado/i)
    expect(mocks.tx.businessSubscription.updateMany).not.toHaveBeenCalled()
  })
})

describe('adminReconcileSubscription', () => {
  it('looks up the local subscription and invokes authoritative reconciliation without accepting provider state', async () => {
    mocks.prisma.businessSubscription.findFirst.mockResolvedValue({ id: 'sub-1' })
    mocks.reconcileSubscription.mockResolvedValue({ outcome: 'reconciled', invoices: 1, applied: 1 })
    const { adminReconcileSubscription } = await import('./admin')

    await expect(adminReconcileSubscription('biz-1')).resolves.toMatchObject({ outcome: 'reconciled' })
    expect(mocks.reconcileSubscription).toHaveBeenCalledWith('sub-1')
  })
})
