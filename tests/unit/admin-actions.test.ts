import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import type { BusinessSubscription } from '@prisma/client'

const { requirePlatformAdminUser, mockBusinessSubscription, mockPrisma } = vi.hoisted(() => {
  const mockBusinessSubscription = {
    findFirst: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  }
  return {
    requirePlatformAdminUser: vi.fn(),
    mockBusinessSubscription,
    mockPrisma: {
      plan: { findUnique: vi.fn() },
      $transaction: vi.fn(),
      businessSubscription: mockBusinessSubscription,
      business: { update: vi.fn(), findUnique: vi.fn() },
      subscriptionNotificationDelivery: { createMany: vi.fn() },
      subscriptionPayment: { create: vi.fn(), findUnique: vi.fn(), upsert: vi.fn() },
      subscriptionLog: { create: vi.fn() },
    },
  }
})

vi.mock('@/lib/db', () => ({ prisma: mockPrisma }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

// admin.ts autoriza vía requirePlatformAdminUser (getUser remoto + isPlatformAdmin).
vi.mock('@/lib/auth/user', () => ({ requirePlatformAdminUser }))

// `admin.ts` carga transiciones y reconciliación de suscripciones. Los mocks
// son hoisted para que su carga ocurra al inicializar el archivo, no bajo el
// timeout de un caso ni de un hook.
import * as adminActions from '@/server/actions/admin'

function subscriptionFixture(
  overrides: Partial<BusinessSubscription> = {},
): BusinessSubscription {
  return {
    id: 'sub-1',
    businessId: 'biz-1',
    planId: 'plan-beta',
    status: 'trialing',
    interval: 'monthly',
    currentPeriodStart: new Date('2026-08-01T00:00:00.000Z'),
    currentPeriodEnd: new Date('2026-09-01T00:00:00.000Z'),
    trialStartAt: new Date('2026-08-01T00:00:00.000Z'),
    trialEndAt: new Date('2026-08-31T00:00:00.000Z'),
    trialDays: 30,
    cancelledAt: null,
    suspendedAt: null,
    suspendedReason: null,
    amount: 14_990,
    currency: 'CLP',
    provider: 'manual',
    environment: null,
    providerPlanId: null,
    providerSubscriptionId: null,
    nextBillingAt: null,
    lastPaidAt: null,
    pastDueAt: null,
    graceEndsAt: null,
    graceDays: 7,
    graceEnforcementDeferredAt: null,
    cancelAtPeriodEnd: false,
    cancellationRequestedAt: null,
    complimentaryUntil: null,
    complimentaryReason: null,
    billingEnabled: false,
    lastReconciledAt: null,
    billingCronClaimedUntil: null,
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    updatedAt: new Date('2026-08-01T00:00:00.000Z'),
    ...overrides,
  }
}

function setupTxMock() {
  mockBusinessSubscription.updateMany.mockResolvedValue({ count: 1 })
  vi.mocked(mockPrisma.$transaction).mockImplementation(async (operations) => {
    if (Array.isArray(operations)) {
      return operations.map((op) => {
        if (op && typeof op === 'object') {
          if ('createMany' in op) return op.createMany()
          if ('update' in op) return op.update()
          if ('updateMany' in op) return op.updateMany()
        }
        return undefined
      })
    }
    if (typeof operations === 'function') {
      return operations(mockPrisma)
    }
    return undefined
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  requirePlatformAdminUser.mockResolvedValue({ id: 'admin-1', email: 'admin@example.com' })
  mockPrisma.subscriptionLog.create.mockResolvedValue({ id: 'subscription-log-1' })
  mockPrisma.business.findUnique.mockResolvedValue({
    name: 'Negocio de prueba',
    users: [{ user: { email: 'owner@example.com' } }],
  })
  mockPrisma.subscriptionNotificationDelivery.createMany.mockResolvedValue({ count: 1 })
})

describe('adminRecordSubscriptionPayment', () => {
  beforeEach(setupTxMock)

  it('rejects NaN amount', async () => {
    await expect(adminActions.adminRecordSubscriptionPayment('biz-1', NaN)).rejects.toThrow('número positivo')
  })

  it('rejects amount <= 0', async () => {
    await expect(adminActions.adminRecordSubscriptionPayment('biz-1', 0)).rejects.toThrow('número positivo')
    await expect(adminActions.adminRecordSubscriptionPayment('biz-1', -100)).rejects.toThrow('número positivo')
  })

  it('rejects non-finite amounts', async () => {
    const nanValue = parseInt('abc', 10)
    await expect(adminActions.adminRecordSubscriptionPayment('biz-1', nanValue)).rejects.toThrow('número positivo')
  })
})

describe('adminExtendTrial', () => {
  beforeEach(setupTxMock)

  it('rejects NaN days', async () => {
    await expect(adminActions.adminExtendTrial('biz-1', NaN)).rejects.toThrow('número entre 1 y 365')
  })

  it('rejects days < 1', async () => {
    await expect(adminActions.adminExtendTrial('biz-1', 0)).rejects.toThrow('número entre 1 y 365')
    await expect(adminActions.adminExtendTrial('biz-1', -5)).rejects.toThrow('número entre 1 y 365')
  })

  it('rejects days > 365', async () => {
    await expect(adminActions.adminExtendTrial('biz-1', 366)).rejects.toThrow('número entre 1 y 365')
    await expect(adminActions.adminExtendTrial('biz-1', 700)).rejects.toThrow('número entre 1 y 365')
  })
})

describe('adminClearComplimentaryPeriod entitlement reset', () => {
  beforeEach(() => {
    setupTxMock()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-15T12:00:00.000Z'))
  })

  afterEach(() => vi.useRealTimers())

  it.each([
    ['short', new Date('2026-08-20T00:00:00.000Z')],
    ['long', new Date('2027-08-20T00:00:00.000Z')],
  ])('starts the full configured trial when clearing a %s exemption', async (_label, until) => {
    mockBusinessSubscription.findFirst.mockResolvedValue(subscriptionFixture({
      complimentaryUntil: until,
      complimentaryReason: 'family',
      trialStartAt: new Date('2026-01-01T00:00:00.000Z'),
      trialEndAt: new Date('2026-01-31T00:00:00.000Z'),
      currentPeriodStart: new Date('2026-01-01T00:00:00.000Z'),
      currentPeriodEnd: new Date('2026-01-31T00:00:00.000Z'),
      trialDays: 30,
    }))

    const { adminClearComplimentaryPeriod } = await import('@/server/actions/admin')
    await adminClearComplimentaryPeriod('biz-1', 'fin de beneficio')

    expect(mockBusinessSubscription.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: 'trialing',
        complimentaryUntil: null,
        complimentaryReason: null,
        trialStartAt: new Date('2026-08-15T12:00:00.000Z'),
        trialEndAt: new Date('2026-09-14T12:00:00.000Z'),
        currentPeriodStart: new Date('2026-08-15T12:00:00.000Z'),
        currentPeriodEnd: new Date('2026-09-14T12:00:00.000Z'),
        pastDueAt: null,
        graceEndsAt: null,
        suspendedAt: null,
      }),
    }))
    expect(mockPrisma.business.update).toHaveBeenCalledWith({
      where: { id: 'biz-1' },
      data: expect.objectContaining({
        subscriptionStatus: 'trialing',
        trialEndsAt: new Date('2026-09-14T12:00:00.000Z'),
      }),
    })
  })

  it('rejects clearing an already expired exemption instead of granting a retroactive trial', async () => {
    mockBusinessSubscription.findFirst.mockResolvedValue(subscriptionFixture({
      complimentaryUntil: new Date('2026-08-14T00:00:00.000Z'),
      complimentaryReason: 'expired',
    }))
    const { adminClearComplimentaryPeriod } = await import('@/server/actions/admin')
    await expect(adminClearComplimentaryPeriod('biz-1', 'late clear'))
      .rejects.toThrow(/exención vigente/i)
    expect(mockBusinessSubscription.updateMany).not.toHaveBeenCalled()
  })
})

describe('adminSetComplimentaryPeriod entitlement', () => {
  beforeEach(() => {
    setupTxMock()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-15T12:00:00.000Z'))
  })
  afterEach(() => vi.useRealTimers())

  it('restores access immediately instead of waiting for the daily cron', async () => {
    mockPrisma.business.findUnique
      .mockResolvedValueOnce({ timezone: 'America/Santiago' })
      .mockResolvedValue({
        name: 'Negocio de prueba',
        users: [{ user: { email: 'owner@example.com' } }],
      })
    mockBusinessSubscription.findFirst.mockResolvedValue(subscriptionFixture({
      status: 'suspended',
      suspendedAt: new Date('2026-08-14T00:00:00.000Z'),
      suspendedReason: 'grace expired',
      pastDueAt: new Date('2026-08-01T00:00:00.000Z'),
      graceEndsAt: new Date('2026-08-08T00:00:00.000Z'),
    }))

    const { adminSetComplimentaryPeriod } = await import('@/server/actions/admin')
    await adminSetComplimentaryPeriod('biz-1', '2027-01-15', 'family')

    expect(mockBusinessSubscription.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: 'trialing',
        complimentaryUntil: new Date('2027-01-16T02:59:59.999Z'),
        complimentaryReason: 'family',
        pastDueAt: null,
        graceEndsAt: null,
        suspendedAt: null,
        suspendedReason: null,
      }),
    }))
    expect(mockPrisma.business.update).toHaveBeenCalledWith({
      where: { id: 'biz-1' },
      data: expect.objectContaining({ subscriptionStatus: 'trialing' }),
    })
  })

  it.each([
    ['manual pending cancellation', {
      provider: 'manual' as const,
      providerSubscriptionId: null,
      cancelAtPeriodEnd: true,
      cancellationRequestedAt: new Date('2026-08-10T00:00:00.000Z'),
    }],
    ['provider-backed cancelled', {
      provider: 'mercado_pago' as const,
      environment: 'sandbox' as const,
      providerSubscriptionId: 'provider-sub-1',
      status: 'cancelled' as const,
      cancelledAt: new Date('2026-08-10T00:00:00.000Z'),
    }],
    ['inconsistent cancelledAt', {
      provider: 'manual' as const,
      providerSubscriptionId: null,
      status: 'active' as const,
      cancelledAt: new Date('2026-08-10T00:00:00.000Z'),
    }],
  ])('rejects complimentary assignment for %s without mutation or audit', async (_label, overrides) => {
    mockPrisma.business.findUnique.mockResolvedValueOnce({ timezone: 'America/Santiago' })
    mockBusinessSubscription.findFirst.mockResolvedValue(subscriptionFixture(overrides))
    const { adminSetComplimentaryPeriod } = await import('@/server/actions/admin')

    await expect(adminSetComplimentaryPeriod('biz-1', '2027-01-15', 'family'))
      .rejects.toThrow(/cancelación|cancelada/i)
    expect(mockBusinessSubscription.updateMany).not.toHaveBeenCalled()
    expect(mockPrisma.subscriptionLog.create).not.toHaveBeenCalled()
  })

  it('does not let clear reopen a complimentary subscription with cancellation pending', async () => {
    mockBusinessSubscription.findFirst.mockResolvedValue(subscriptionFixture({
      complimentaryUntil: new Date('2027-01-15T00:00:00.000Z'),
      complimentaryReason: 'family',
      cancelAtPeriodEnd: true,
      cancellationRequestedAt: new Date('2026-08-10T00:00:00.000Z'),
    }))
    const { adminClearComplimentaryPeriod } = await import('@/server/actions/admin')
    await expect(adminClearComplimentaryPeriod('biz-1', 'remove'))
      .rejects.toThrow(/cancelación/i)
    expect(mockBusinessSubscription.updateMany).not.toHaveBeenCalled()
    expect(mockPrisma.subscriptionLog.create).not.toHaveBeenCalled()
  })
})

describe('adminRecordSubscriptionPayment creates records', () => {
  beforeEach(setupTxMock)

  it('creates SubscriptionPayment and SubscriptionLog', async () => {
    mockPrisma.businessSubscription.findFirst.mockResolvedValue(
      subscriptionFixture({ status: 'trialing' }),
    )

    const { adminRecordSubscriptionPayment } = await import('@/server/actions/admin')
    await adminRecordSubscriptionPayment('biz-1', 30000, 'pago de prueba')

    expect(mockPrisma.subscriptionPayment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        businessId: 'biz-1',
        amount: 30000,
        currency: 'CLP',
        status: 'approved',
        paymentMethod: 'manual',
        notes: 'pago de prueba',
      }),
    })

    expect(mockPrisma.subscriptionLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        businessId: 'biz-1',
        action: 'payment_recorded_by_admin',
        beforeStatus: 'trialing',
        afterStatus: 'active',
        adminEmail: 'admin@example.com',
      }),
    })
  })
})

describe('adminSuspendBusiness', () => {
  beforeEach(setupTxMock)

  it('rejects when no subscription exists', async () => {
    mockBusinessSubscription.findFirst.mockResolvedValue(null)
    const { adminSuspendBusiness } = await import('@/server/actions/admin')
    await expect(adminSuspendBusiness('biz-1')).rejects.toThrow('No se encontró suscripción')
  })

  it('creates subscriptionLog with beforeStatus', async () => {
    mockBusinessSubscription.findFirst.mockResolvedValue(
      subscriptionFixture({ status: 'active' }),
    )

    const { adminSuspendBusiness } = await import('@/server/actions/admin')
    await adminSuspendBusiness('biz-1', 'incumplimiento')

    expect(mockPrisma.subscriptionLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        businessId: 'biz-1',
        action: 'business_suspended_by_admin',
        beforeStatus: 'active',
        afterStatus: 'suspended',
        adminEmail: 'admin@example.com',
        notes: 'incumplimiento',
      }),
    })
  })
})

describe('adminActivateBusiness', () => {
  beforeEach(setupTxMock)

  it('rejects when no subscription exists', async () => {
    mockBusinessSubscription.findFirst.mockResolvedValue(null)
    const { adminActivateBusiness } = await import('@/server/actions/admin')
    await expect(adminActivateBusiness('biz-1')).rejects.toThrow('No se encontró suscripción')
  })

  it('creates subscriptionLog', async () => {
    mockBusinessSubscription.findFirst.mockResolvedValue(
      subscriptionFixture({ status: 'suspended' }),
    )

    const { adminActivateBusiness } = await import('@/server/actions/admin')
    await adminActivateBusiness('biz-1')

    expect(mockPrisma.subscriptionLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        businessId: 'biz-1',
        action: 'business_activated_by_admin',
        beforeStatus: 'suspended',
        afterStatus: 'active',
        adminEmail: 'admin@example.com',
      }),
    })
  })
})

describe('adminChangePlan', () => {
  beforeEach(setupTxMock)

  it('rejects non-existent plan', async () => {
    mockPrisma.plan.findUnique.mockResolvedValue(null)
    const { adminChangePlan } = await import('@/server/actions/admin')
    await expect(adminChangePlan('biz-1', 'nonexistent-plan')).rejects.toThrow('El plan no existe')
  })

  it('rejects when no subscription exists', async () => {
    mockPrisma.plan.findUnique.mockResolvedValue({ id: 'plan-pro', name: 'Pro' })
    mockBusinessSubscription.findFirst.mockResolvedValue(null)
    const { adminChangePlan } = await import('@/server/actions/admin')
    await expect(adminChangePlan('biz-1', 'plan-pro')).rejects.toThrow('No se encontró suscripción')
  })

  it('creates log with updated plan', async () => {
    mockPrisma.plan.findUnique.mockResolvedValue({ id: 'plan-pro', name: 'Pro' })
    mockBusinessSubscription.findFirst.mockResolvedValue(
      subscriptionFixture({ status: 'active', planId: 'plan-beta' }),
    )

    const { adminChangePlan } = await import('@/server/actions/admin')
    await adminChangePlan('biz-1', 'plan-pro')

    expect(mockPrisma.subscriptionLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        businessId: 'biz-1',
        action: 'plan_changed_by_admin',
        beforePlanId: 'plan-beta',
        afterPlanId: 'plan-pro',
        adminEmail: 'admin@example.com',
      }),
    })
  })
})

describe('adminMarkPastDue', () => {
  beforeEach(setupTxMock)

  it('rejects when no subscription exists', async () => {
    mockBusinessSubscription.findFirst.mockResolvedValue(null)
    const { adminMarkPastDue } = await import('@/server/actions/admin')
    await expect(adminMarkPastDue('biz-1')).rejects.toThrow('No se encontró suscripción')
  })

  it('creates log with past_due status', async () => {
    mockBusinessSubscription.findFirst.mockResolvedValue(
      subscriptionFixture({ status: 'active' }),
    )

    const { adminMarkPastDue } = await import('@/server/actions/admin')
    await adminMarkPastDue('biz-1')

    expect(mockPrisma.subscriptionLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        businessId: 'biz-1',
        action: 'marked_past_due_by_admin',
        beforeStatus: 'active',
        afterStatus: 'past_due',
      }),
    })
  })
})

describe('adminCancelSubscription', () => {
  beforeEach(setupTxMock)

  it('rejects when no subscription exists', async () => {
    mockBusinessSubscription.findFirst.mockResolvedValue(null)
    const { adminCancelSubscription } = await import('@/server/actions/admin')
    await expect(adminCancelSubscription('biz-1')).rejects.toThrow('No se encontró suscripción')
  })

  it('creates a deferred cancellation log without cutting entitlement', async () => {
    mockBusinessSubscription.findFirst.mockResolvedValue(
      subscriptionFixture({ status: 'active' }),
    )

    const { adminCancelSubscription } = await import('@/server/actions/admin')
    await adminCancelSubscription('biz-1', 'cliente solicitó baja')

    expect(mockPrisma.subscriptionLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        businessId: 'biz-1',
        action: 'subscription_cancellation_requested_by_admin',
        beforeStatus: 'active',
        afterStatus: 'active',
        notes: 'cliente solicitó baja',
      }),
    })
  })
})
