import { describe, expect, it, vi, beforeEach } from 'vitest'

const { requirePlatformAdmin, mockBusinessSubscription } = vi.hoisted(() => ({
  requirePlatformAdmin: vi.fn(),
  mockBusinessSubscription: {
    findFirst: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
}))

const mockPrisma = {
  plan: { findUnique: vi.fn() },
  $transaction: vi.fn(),
  businessSubscription: mockBusinessSubscription,
  business: { update: vi.fn() },
  subscriptionPayment: { create: vi.fn() },
  subscriptionLog: { create: vi.fn() },
}

vi.mock('@/lib/db', () => ({ prisma: mockPrisma }))

vi.mock('@/lib/auth/user', () => ({
  getCurrentUser: vi.fn().mockResolvedValue({ id: 'admin-1', email: 'admin@example.com' }),
}))

vi.mock('@/lib/auth/platform-admin', () => ({
  requirePlatformAdmin,
  isPlatformAdmin: vi.fn().mockReturnValue(true),
}))

function setupTxMock() {
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
  requirePlatformAdmin.mockImplementation(() => {})
})

describe('adminRecordSubscriptionPayment', () => {
  beforeEach(setupTxMock)

  it('rejects NaN amount', async () => {
    const { adminRecordSubscriptionPayment } = await import('@/server/actions/admin')
    await expect(adminRecordSubscriptionPayment('biz-1', NaN)).rejects.toThrow('número positivo')
  })

  it('rejects amount <= 0', async () => {
    const { adminRecordSubscriptionPayment } = await import('@/server/actions/admin')
    await expect(adminRecordSubscriptionPayment('biz-1', 0)).rejects.toThrow('número positivo')
    await expect(adminRecordSubscriptionPayment('biz-1', -100)).rejects.toThrow('número positivo')
  })

  it('rejects non-finite amounts', async () => {
    const { adminRecordSubscriptionPayment } = await import('@/server/actions/admin')
    const nanValue = parseInt('abc', 10)
    await expect(adminRecordSubscriptionPayment('biz-1', nanValue)).rejects.toThrow('número positivo')
  })
})

describe('adminExtendTrial', () => {
  beforeEach(setupTxMock)

  it('rejects NaN days', async () => {
    const { adminExtendTrial } = await import('@/server/actions/admin')
    await expect(adminExtendTrial('biz-1', NaN)).rejects.toThrow('número entre 1 y 365')
  })

  it('rejects days < 1', async () => {
    const { adminExtendTrial } = await import('@/server/actions/admin')
    await expect(adminExtendTrial('biz-1', 0)).rejects.toThrow('número entre 1 y 365')
    await expect(adminExtendTrial('biz-1', -5)).rejects.toThrow('número entre 1 y 365')
  })

  it('rejects days > 365', async () => {
    const { adminExtendTrial } = await import('@/server/actions/admin')
    await expect(adminExtendTrial('biz-1', 366)).rejects.toThrow('número entre 1 y 365')
    await expect(adminExtendTrial('biz-1', 700)).rejects.toThrow('número entre 1 y 365')
  })
})

describe('adminRecordSubscriptionPayment creates records', () => {
  beforeEach(setupTxMock)

  it('creates SubscriptionPayment and SubscriptionLog', async () => {
    mockPrisma.businessSubscription.findFirst.mockResolvedValue({
      id: 'sub-1',
      businessId: 'biz-1',
      status: 'trialing',
      planId: 'plan-beta',
    })

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
    mockBusinessSubscription.findFirst.mockResolvedValue({
      id: 'sub-1',
      businessId: 'biz-1',
      status: 'active',
    })

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
    mockBusinessSubscription.findFirst.mockResolvedValue({
      id: 'sub-1',
      businessId: 'biz-1',
      status: 'suspended',
    })

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
    mockBusinessSubscription.findFirst.mockResolvedValue({
      id: 'sub-1',
      businessId: 'biz-1',
      status: 'active',
      planId: 'plan-beta',
    })

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
    mockBusinessSubscription.findFirst.mockResolvedValue({
      id: 'sub-1',
      businessId: 'biz-1',
      status: 'active',
    })

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

  it('creates log with cancelled status', async () => {
    mockBusinessSubscription.findFirst.mockResolvedValue({
      id: 'sub-1',
      businessId: 'biz-1',
      status: 'active',
    })

    const { adminCancelSubscription } = await import('@/server/actions/admin')
    await adminCancelSubscription('biz-1', 'cliente solicitó baja')

    expect(mockPrisma.subscriptionLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        businessId: 'biz-1',
        action: 'subscription_cancelled_by_admin',
        beforeStatus: 'active',
        afterStatus: 'cancelled',
        notes: 'cliente solicitó baja',
      }),
    })
  })
})
