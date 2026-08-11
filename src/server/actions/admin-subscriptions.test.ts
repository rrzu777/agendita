import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requirePlatformAdminUser: vi.fn(),
  reconcileSubscription: vi.fn(),
  applySubscriptionTransition: vi.fn(),
  revalidatePath: vi.fn(),
  tx: {
    plan: { findUnique: vi.fn() },
    businessSubscription: { findFirst: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn() },
    business: { update: vi.fn(), findUnique: vi.fn() },
    subscriptionLog: { create: vi.fn() },
  },
  prisma: {
    $transaction: vi.fn(),
    businessSubscription: { findFirst: vi.fn() },
    business: { findUnique: vi.fn() },
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
vi.mock('@/lib/subscriptions/transition', () => ({
  applySubscriptionTransition: (...args: unknown[]) => mocks.applySubscriptionTransition(...args),
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
  mocks.prisma.business.findUnique.mockResolvedValue({ timezone: 'America/Santiago' })
  mocks.tx.subscriptionLog.create.mockResolvedValue({ id: 'log-1' })
})

describe('recurring billing admin authorization', () => {
  it('rejects every action before reading or mutating billing data when user is not platform admin', async () => {
    mocks.requirePlatformAdminUser.mockRejectedValue(new Error('Sin permisos'))
    const actions = await import('./admin')

    await expect(actions.adminSetComplimentaryPeriod('biz-1', '2099-09-01', 'familia'))
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
    await expect(adminSetComplimentaryPeriod('biz-1', 'fecha-inválida', 'familia'))
      .rejects.toThrow(/fecha/i)
    await expect(adminSetComplimentaryPeriod('biz-1', '2099-01-01', '   '))
      .rejects.toThrow(/motivo/i)
    await expect(adminSetComplimentaryPeriod('biz-1', '2027-02-30', 'familia'))
      .rejects.toThrow(/fecha/i)
  })

  it('rejects an invalid persisted business timezone', async () => {
    mocks.prisma.business.findUnique.mockResolvedValue({ timezone: 'Chile/Invalid' })
    const { adminSetComplimentaryPeriod } = await import('./admin')
    await expect(adminSetComplimentaryPeriod('biz-1', '2027-01-15', 'familia'))
      .rejects.toThrow(/zona horaria/i)
    expect(mocks.tx.businessSubscription.updateMany).not.toHaveBeenCalled()
  })

  it.each([
    ['2027-01-15', '2027-01-16T02:59:59.999Z'],
    ['2027-07-15', '2027-07-16T03:59:59.999Z'],
    ['2026-09-05', '2026-09-06T03:59:59.999Z'],
  ])('resolves Chilean date-only %s to local end-of-day across DST', async (dateOnly, expected) => {
    const { adminSetComplimentaryPeriod } = await import('./admin')
    await adminSetComplimentaryPeriod('biz-1', dateOnly, 'Family & friends')

    expect(mocks.applySubscriptionTransition).toHaveBeenCalledWith(mocks.prisma, {
      businessId: 'biz-1',
      command: {
        type: 'admin_set_complimentary',
        complimentaryUntil: new Date(expected),
        reason: 'Family & friends',
      },
      actor: { userId: 'admin-1', email: 'admin@agendita.cl', notes: 'Family & friends' },
    })
  })

  it('does not pretend to exempt a subscription that can still charge at the provider', async () => {
    mocks.applySubscriptionTransition.mockRejectedValueOnce(new Error(
      'Primero cancela y confirma la autorización externa antes de asignar una exención',
    ))
    const { adminSetComplimentaryPeriod } = await import('./admin')
    await expect(adminSetComplimentaryPeriod('biz-1', '2099-01-01', 'familia'))
      .rejects.toThrow(/autorización/i)
    expect(mocks.tx.businessSubscription.updateMany).not.toHaveBeenCalled()
  })
})

describe('adminClearComplimentaryPeriod', () => {
  it('requires a reason and starts a fresh configured trial through the transition service', async () => {
    const { adminClearComplimentaryPeriod } = await import('./admin')
    await expect(adminClearComplimentaryPeriod('biz-1', '')).rejects.toThrow(/motivo/i)
    await adminClearComplimentaryPeriod('biz-1', 'Terminó beneficio')

    expect(mocks.applySubscriptionTransition).toHaveBeenCalledWith(mocks.prisma, {
      businessId: 'biz-1',
      command: { type: 'admin_clear_complimentary', occurredAt: expect.any(Date) },
      actor: { userId: 'admin-1', email: 'admin@agendita.cl', notes: 'Terminó beneficio' },
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

  it('rejects disabling while the billing lease is active', async () => {
    mocks.tx.businessSubscription.updateMany.mockResolvedValue({ count: 0 })
    mocks.tx.businessSubscription.findUnique.mockResolvedValue({
      billingCronClaimedUntil: new Date(Date.now() + 60_000),
    })
    const { adminConfigureBilling } = await import('./admin')
    await expect(adminConfigureBilling('biz-1', {
      planId: 'plan-pro', trialDays: 30, graceDays: 7, billingEnabled: false,
    })).rejects.toThrow(/procesando/i)
    expect(mocks.tx.business.update).not.toHaveBeenCalled()
  })
})

describe('adminReconcileSubscription', () => {
  it('looks up the local subscription and invokes authoritative reconciliation without accepting provider state', async () => {
    mocks.prisma.businessSubscription.findFirst.mockResolvedValue({ id: 'sub-1' })
    mocks.reconcileSubscription.mockResolvedValue({ outcome: 'reconciled', invoices: 1, applied: 1 })
    const { adminReconcileSubscription } = await import('./admin')

    await expect(adminReconcileSubscription('biz-1')).resolves.toMatchObject({ outcome: 'reconciled' })
    expect(mocks.reconcileSubscription).toHaveBeenCalledWith('sub-1')
    expect(mocks.tx.subscriptionLog.create).toHaveBeenLastCalledWith({ data: expect.objectContaining({
      action: 'subscription_reconciliation_succeeded',
      notes: expect.stringContaining('log-1'),
      adminUserId: 'admin-1',
    }) })
  })

  it('does not call the provider when the durable request audit fails', async () => {
    mocks.prisma.businessSubscription.findFirst.mockResolvedValue({ id: 'sub-1' })
    mocks.tx.subscriptionLog.create.mockRejectedValueOnce(new Error('audit unavailable'))
    const { adminReconcileSubscription } = await import('./admin')

    await expect(adminReconcileSubscription('biz-1')).rejects.toThrow('audit unavailable')
    expect(mocks.reconcileSubscription).not.toHaveBeenCalled()
  })

  it('records an attributable failed outcome when the provider call fails', async () => {
    mocks.prisma.businessSubscription.findFirst.mockResolvedValue({ id: 'sub-1' })
    mocks.tx.subscriptionLog.create
      .mockResolvedValueOnce({ id: 'request-log-1' })
      .mockResolvedValueOnce({ id: 'outcome-log-1' })
    mocks.reconcileSubscription.mockRejectedValue(new Error('provider timeout'))
    const { adminReconcileSubscription } = await import('./admin')

    await expect(adminReconcileSubscription('biz-1')).rejects.toThrow('provider timeout')
    expect(mocks.tx.subscriptionLog.create).toHaveBeenLastCalledWith({ data: expect.objectContaining({
      action: 'subscription_reconciliation_failed',
      notes: expect.stringContaining('request-log-1'),
      adminUserId: 'admin-1',
    }) })
  })
})
