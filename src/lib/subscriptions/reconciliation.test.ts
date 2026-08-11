import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import type { MpInvoice, MpSubscription } from './mercado-pago-mappers'
import {
  reconcileSubscription,
  type ReconciliationDependencies,
} from './reconciliation'

const NOW = new Date('2026-08-11T12:00:00.000Z')
const REFERENCE = 'opaque-reference'
const localSubscription = {
  id: 'subscription-local',
  businessId: 'business-local',
  planId: 'plan-local',
  interval: 'monthly' as const,
  status: 'past_due' as const,
  provider: 'mercado_pago' as const,
  environment: 'sandbox' as const,
  providerSubscriptionId: 'provider-subscription',
  providerPlanId: 'provider-plan',
  amount: 15_000,
  currency: 'CLP',
  currentPeriodEnd: new Date('2026-06-11T10:00:00.000Z'),
  lastPaidAt: null,
  cancelAtPeriodEnd: false,
}
const providerSubscription: MpSubscription = {
  id: 'provider-subscription',
  status: 'active',
  providerStatus: 'authorized',
  collectorId: 'provider-account',
  planId: 'provider-plan',
  externalReference: REFERENCE,
  checkoutUrl: null,
  amount: 15_000,
  currency: 'CLP',
  frequency: 1,
  frequencyType: 'months',
  nextPaymentAt: new Date('2026-08-11T10:00:00.000Z'),
  updatedAt: new Date('2026-08-11T11:00:00.000Z'),
}
const checkoutAttempt = {
  id: 'attempt-local',
  businessId: localSubscription.businessId,
  subscriptionId: localSubscription.id,
  environment: 'sandbox' as const,
  referenceHash: createHash('sha256').update(REFERENCE).digest('hex'),
  providerSubscriptionId: providerSubscription.id,
  providerPlanId: providerSubscription.planId,
  planId: localSubscription.planId,
  amount: localSubscription.amount,
  currency: localSubscription.currency,
}

function invoice(input: {
  id: string
  status: 'approved' | 'failed' | 'pending' | 'ignored'
  debitAt: string
  approvedAt?: string
}): MpInvoice {
  return {
    id: input.id,
    subscriptionId: providerSubscription.id,
    status: input.status,
    providerPaymentId: input.status === 'approved' ? `payment-${input.id}` : null,
    providerStatus: input.status === 'approved'
      ? 'approved'
      : input.status === 'failed'
        ? 'rejected'
        : input.status,
    amount: 15_000,
    currency: 'CLP',
    externalReference: REFERENCE,
    approvedAt: input.approvedAt ? new Date(input.approvedAt) : null,
    createdAt: new Date(input.debitAt),
    updatedAt: new Date(input.approvedAt ?? input.debitAt),
    debitAt: new Date(input.debitAt),
  }
}

const JUNE_APPROVED = invoice({
  id: 'invoice-june-approved',
  status: 'approved',
  debitAt: '2026-06-11T10:00:00.000Z',
  approvedAt: '2026-06-11T12:00:00.000Z',
})
const JULY_APPROVED = invoice({
  id: 'invoice-july-approved',
  status: 'approved',
  debitAt: '2026-07-11T10:00:00.000Z',
  approvedAt: '2026-07-12T12:00:00.000Z',
})
const AUGUST_FAILED = invoice({
  id: 'invoice-august-failed',
  status: 'failed',
  debitAt: '2026-08-11T10:00:00.000Z',
})

function createDependencies(overrides: {
  local?: typeof localSubscription
  subscription?: MpSubscription
  attempt?: typeof checkoutAttempt | null
  invoices?: MpInvoice[]
} = {}) {
  const process = vi.fn().mockResolvedValue({ outcome: 'applied', status: 'active' })
  const client = {
    getSubscription: vi.fn().mockResolvedValue(overrides.subscription ?? providerSubscription),
    searchInvoices: vi.fn().mockResolvedValue(overrides.invoices ?? [JULY_APPROVED]),
    getCurrentAccountId: vi.fn().mockResolvedValue('provider-account'),
    cancelSubscription: vi.fn().mockResolvedValue({
      ...providerSubscription,
      status: 'canceled',
      providerStatus: 'canceled',
      nextPaymentAt: null,
    }),
  }
  const dependencies = {
    prisma: {
      businessSubscription: {
        findUnique: vi.fn().mockResolvedValue(overrides.local ?? localSubscription),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      subscriptionCheckoutAttempt: {
        findFirst: vi.fn().mockResolvedValue(
          overrides.attempt === undefined ? checkoutAttempt : overrides.attempt,
        ),
      },
      subscriptionPayment: { findMany: vi.fn().mockResolvedValue([]) },
    },
    getProcessor: vi.fn().mockReturnValue({ client, process }),
    now: () => NOW,
  } as unknown as ReconciliationDependencies
  return { dependencies, client, process }
}

function expectNoSuccessfulReconciliation(dependencies: ReconciliationDependencies) {
  expect(dependencies.prisma.businessSubscription.updateMany).not.toHaveBeenCalled()
}

describe('reconcileSubscription', () => {
  it('repara todos los aprobados faltantes en orden de debitAt', async () => {
    const { dependencies, process } = createDependencies({
      invoices: [JULY_APPROVED, JUNE_APPROVED],
    })

    await expect(reconcileSubscription(localSubscription.id, dependencies)).resolves.toEqual({
      outcome: 'reconciled', invoices: 2, applied: 2,
    })
    expect(process.mock.calls.map(([event]) => event.resourceId)).toEqual([
      JUNE_APPROVED.id,
      JULY_APPROVED.id,
    ])
    expect(process.mock.calls.map(([event]) => event.periodEnd)).toEqual([
      JULY_APPROVED.debitAt,
      providerSubscription.nextPaymentAt,
    ])
  })

  it('aplica un aprobado perdido y luego un fallo terminal posterior', async () => {
    const { dependencies, process } = createDependencies({
      invoices: [AUGUST_FAILED, JULY_APPROVED],
    })

    await expect(reconcileSubscription(localSubscription.id, dependencies)).resolves.toMatchObject({
      invoices: 2,
      applied: 2,
    })
    expect(process.mock.calls.map(([event]) => event.resourceId)).toEqual([
      JULY_APPROVED.id,
      AUGUST_FAILED.id,
    ])
  })

  it('procesa settlements antes de cancelación para no cerrar con período local obsoleto', async () => {
    const { dependencies, process } = createDependencies({
      subscription: {
        ...providerSubscription,
        status: 'canceled',
        providerStatus: 'canceled',
        nextPaymentAt: null,
      },
      invoices: [AUGUST_FAILED, JULY_APPROVED],
    })

    await expect(reconcileSubscription(localSubscription.id, dependencies)).resolves.toMatchObject({
      invoices: 2,
    })
    expect(process.mock.calls.map(([event]) => [event.topic, event.resourceId])).toEqual([
      ['subscription_authorized_payment', JULY_APPROVED.id],
      ['subscription_authorized_payment', AUGUST_FAILED.id],
      ['subscription_preapproval', providerSubscription.id],
    ])
  })

  it('difiere la cancelación si el lote completo ya consumió el presupuesto de red', async () => {
    const failures = [0, 1, 2].map((index) => invoice({
      id: `invoice-canceled-budget-${index}`,
      status: 'failed',
      debitAt: new Date(Date.UTC(2026, 5 + index, 11, 10)).toISOString(),
    }))
    const durableClaims = new Map<string, {
      id: string
      businessId: string
      subscriptionId: string
      provider: string
      environment: 'sandbox'
      status: string
      providerPaymentId: string | null
      providerInvoiceId: string
    }>()
    const { dependencies, process } = createDependencies({
      subscription: {
        ...providerSubscription,
        status: 'canceled',
        providerStatus: 'canceled',
        nextPaymentAt: null,
      },
      invoices: failures,
    })
    ;(dependencies.prisma.subscriptionPayment.findMany as ReturnType<typeof vi.fn>)
      .mockImplementation(async () => [...durableClaims.values()])
    process.mockImplementation(async (event) => {
      if (event.topic === 'subscription_authorized_payment') {
        durableClaims.set(event.resourceId, {
          id: `claim-${event.resourceId}`,
          businessId: localSubscription.businessId,
          subscriptionId: localSubscription.id,
          provider: 'mercado_pago',
          environment: 'sandbox',
          status: 'rejected',
          providerPaymentId: null,
          providerInvoiceId: event.resourceId,
        })
      }
      return { outcome: 'applied' as const, status: 'past_due' }
    })

    await expect(reconcileSubscription(localSubscription.id, dependencies))
      .rejects.toMatchObject({ name: 'SubscriptionReconciliationPartialError' })
    expect(process).toHaveBeenCalledTimes(3)
    expect(process.mock.calls.every(([event]) =>
      event.topic === 'subscription_authorized_payment')).toBe(true)
    expectNoSuccessfulReconciliation(dependencies)

    await expect(reconcileSubscription(localSubscription.id, dependencies)).resolves.toMatchObject({
      outcome: 'reconciled', invoices: 3, applied: 1,
    })
    expect(process).toHaveBeenCalledTimes(4)
    expect(process.mock.calls[3]?.[0].topic).toBe('subscription_preapproval')
    expect(dependencies.prisma.businessSubscription.updateMany).toHaveBeenCalledTimes(1)
  })

  it('difiere cancelSubscription si tres invoices ya agotaron el presupuesto', async () => {
    const failures = [0, 1, 2].map((index) => invoice({
      id: `invoice-active-budget-${index}`,
      status: 'failed',
      debitAt: new Date(Date.UTC(2026, 5 + index, 11, 10)).toISOString(),
    }))
    const durableClaims = new Map<string, LocalClaim>()
    type LocalClaim = {
      id: string
      businessId: string
      subscriptionId: string
      provider: string
      environment: 'sandbox'
      status: string
      providerPaymentId: string | null
      providerInvoiceId: string
    }
    const { dependencies, client, process } = createDependencies({
      local: { ...localSubscription, cancelAtPeriodEnd: true },
      invoices: failures,
    })
    ;(dependencies.prisma.subscriptionPayment.findMany as ReturnType<typeof vi.fn>)
      .mockImplementation(async () => [...durableClaims.values()])
    process.mockImplementation(async (event) => {
      durableClaims.set(event.resourceId, {
        id: `claim-${event.resourceId}`,
        businessId: localSubscription.businessId,
        subscriptionId: localSubscription.id,
        provider: 'mercado_pago',
        environment: 'sandbox',
        status: 'rejected',
        providerPaymentId: null,
        providerInvoiceId: event.resourceId,
      })
      return { outcome: 'applied' as const, status: 'past_due' }
    })

    await expect(reconcileSubscription(localSubscription.id, dependencies))
      .rejects.toMatchObject({ name: 'SubscriptionReconciliationPartialError' })
    expect(process).toHaveBeenCalledTimes(3)
    expect(client.cancelSubscription).not.toHaveBeenCalled()
    expectNoSuccessfulReconciliation(dependencies)

    await expect(reconcileSubscription(localSubscription.id, dependencies)).resolves.toMatchObject({
      outcome: 'reconciled', invoices: 3, applied: 0,
    })
    expect(process).toHaveBeenCalledTimes(3)
    expect(client.cancelSubscription).toHaveBeenCalledTimes(1)
    expect(dependencies.prisma.businessSubscription.updateMany).toHaveBeenCalledTimes(1)
  })

  it('reintenta cancelar renovaciones aun si el approved exacto no requiere refetch', async () => {
    const { dependencies, client, process } = createDependencies({
      local: { ...localSubscription, cancelAtPeriodEnd: true },
      invoices: [JULY_APPROVED],
    })
    ;(dependencies.prisma.subscriptionPayment.findMany as ReturnType<typeof vi.fn>)
      .mockResolvedValue([{
        id: 'claim-approved-exact',
        businessId: localSubscription.businessId,
        subscriptionId: localSubscription.id,
        provider: 'mercado_pago',
        environment: 'sandbox',
        status: 'approved',
        providerPaymentId: JULY_APPROVED.providerPaymentId,
        providerInvoiceId: JULY_APPROVED.id,
      }])
    client.cancelSubscription
      .mockRejectedValueOnce(new Error('ambiguous cancellation'))

    await expect(reconcileSubscription(localSubscription.id, dependencies))
      .rejects.toThrow('ambiguous cancellation')
    expect(process).not.toHaveBeenCalled()
    expectNoSuccessfulReconciliation(dependencies)

    await expect(reconcileSubscription(localSubscription.id, dependencies)).resolves.toMatchObject({
      outcome: 'reconciled', invoices: 1, applied: 0,
    })
    expect(client.cancelSubscription).toHaveBeenCalledTimes(2)
    expect(process).not.toHaveBeenCalled()
    expect(dependencies.prisma.businessSubscription.updateMany).toHaveBeenCalledTimes(1)
  })

  it('permite cerrar canceled sin nextPaymentAt sólo si el último approved ya es duplicate', async () => {
    const { dependencies, process } = createDependencies({
      subscription: {
        ...providerSubscription,
        status: 'canceled',
        providerStatus: 'canceled',
        nextPaymentAt: null,
      },
      invoices: [JULY_APPROVED],
    })
    process
      .mockResolvedValueOnce({ outcome: 'duplicate', status: 'active' })
      .mockResolvedValueOnce({ outcome: 'applied', status: 'active' })

    await expect(reconcileSubscription(localSubscription.id, dependencies)).resolves.toEqual({
      outcome: 'reconciled', invoices: 1, applied: 1,
    })
    expect(process.mock.calls[0]?.[0]).toMatchObject({
      resourceId: JULY_APPROVED.id,
      periodEnd: undefined,
    })
    expect(process.mock.calls[1]?.[0]).toMatchObject({
      topic: 'subscription_preapproval',
    })
  })

  it.each([
    ['pending', invoice({ id: 'pending', status: 'pending', debitAt: '2026-08-11T10:00:00.000Z' })],
    ['ignored', invoice({ id: 'ignored', status: 'ignored', debitAt: '2026-08-11T10:00:00.000Z' })],
  ])('un evento %s vuelve ambiguo todo el lote antes de mutar', async (_label, unsafeInvoice) => {
    const { dependencies, process } = createDependencies({
      invoices: [JULY_APPROVED, unsafeInvoice],
    })

    await expect(reconcileSubscription(localSubscription.id, dependencies)).rejects.toMatchObject({
      name: 'SubscriptionReconciliationValidationError',
    })
    expect(process).not.toHaveBeenCalled()
    expectNoSuccessfulReconciliation(dependencies)
  })

  it('un outcome ignored del procesador no se declara reconciliado', async () => {
    const { dependencies, process } = createDependencies()
    process.mockResolvedValueOnce({ outcome: 'ignored' })

    await expect(reconcileSubscription(localSubscription.id, dependencies)).rejects.toMatchObject({
      name: 'SubscriptionReconciliationValidationError',
    })
    expectNoSuccessfulReconciliation(dependencies)
  })

  it('un error después de aplicar parcialmente conserva resultado ambiguo para retry idempotente', async () => {
    const { dependencies, process } = createDependencies({
      invoices: [JUNE_APPROVED, JULY_APPROVED],
    })
    process.mockResolvedValueOnce({ outcome: 'applied', status: 'active' })
      .mockRejectedValueOnce(new Error('timeout'))

    await expect(reconcileSubscription(localSubscription.id, dependencies)).rejects.toThrow('timeout')
    expect(process).toHaveBeenCalledTimes(2)
    expectNoSuccessfulReconciliation(dependencies)
  })

  it('valida collector y referencia aun cuando no existen invoices', async () => {
    const wrongCollector = createDependencies({
      subscription: { ...providerSubscription, collectorId: 'other-account' },
      invoices: [],
    })
    await expect(reconcileSubscription(localSubscription.id, wrongCollector.dependencies))
      .rejects.toMatchObject({ name: 'SubscriptionReconciliationValidationError' })
    expectNoSuccessfulReconciliation(wrongCollector.dependencies)

    const wrongReference = createDependencies({
      subscription: { ...providerSubscription, externalReference: 'wrong-reference' },
      invoices: [],
    })
    await expect(reconcileSubscription(localSubscription.id, wrongReference.dependencies))
      .rejects.toMatchObject({ name: 'SubscriptionReconciliationValidationError' })
    expectNoSuccessfulReconciliation(wrongReference.dependencies)
  })

  it('un snapshot válido sin invoices puede marcar reconciliación segura', async () => {
    const { dependencies, client } = createDependencies({ invoices: [] })

    await expect(reconcileSubscription(localSubscription.id, dependencies)).resolves.toEqual({
      outcome: 'reconciled', invoices: 0, applied: 0,
    })
    expect(client.getCurrentAccountId).toHaveBeenCalledTimes(1)
    expect(dependencies.prisma.businessSubscription.updateMany).toHaveBeenCalledWith({
      where: {
        id: localSubscription.id,
        businessId: localSubscription.businessId,
        planId: localSubscription.planId,
        interval: localSubscription.interval,
        provider: 'mercado_pago',
        environment: localSubscription.environment,
        providerSubscriptionId: localSubscription.providerSubscriptionId,
        providerPlanId: localSubscription.providerPlanId,
        amount: localSubscription.amount,
        currency: localSubscription.currency,
      },
      data: { lastReconciledAt: NOW },
    })
  })

  it('omite el refetch de un terminal ya reclamado con los mismos IDs y status', async () => {
    const { dependencies, process } = createDependencies({ invoices: [JULY_APPROVED] })
    ;(dependencies.prisma.subscriptionPayment.findMany as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([{
        id: 'existing-approved-claim',
        businessId: localSubscription.businessId,
        subscriptionId: localSubscription.id,
        provider: 'mercado_pago',
        environment: 'sandbox',
        status: 'approved',
        providerPaymentId: JULY_APPROVED.providerPaymentId,
        providerInvoiceId: JULY_APPROVED.id,
      }])

    await expect(reconcileSubscription(localSubscription.id, dependencies)).resolves.toMatchObject({
      outcome: 'reconciled', applied: 0,
    })
    expect(process).not.toHaveBeenCalled()
  })

  it('mantiene actionable una promoción durable de failed a approved', async () => {
    const { dependencies, process } = createDependencies({ invoices: [JULY_APPROVED] })
    ;(dependencies.prisma.subscriptionPayment.findMany as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([{
        id: 'existing-rejected-claim',
        businessId: localSubscription.businessId,
        subscriptionId: localSubscription.id,
        provider: 'mercado_pago',
        environment: 'sandbox',
        status: 'rejected',
        providerPaymentId: null,
        providerInvoiceId: JULY_APPROVED.id,
      }])

    await reconcileSubscription(localSubscription.id, dependencies)

    expect(process).toHaveBeenCalledTimes(1)
    expect(process).toHaveBeenCalledWith(expect.objectContaining({ resourceId: JULY_APPROVED.id }))
  })

  it('no degrada ni bloquea un approved local si provider regresa el mismo invoice a failed', async () => {
    const providerFailed = {
      ...JULY_APPROVED,
      status: 'failed' as const,
      providerPaymentId: null,
      providerStatus: 'rejected',
      approvedAt: null,
    }
    const { dependencies, process } = createDependencies({ invoices: [providerFailed] })
    ;(dependencies.prisma.subscriptionPayment.findMany as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([{
        id: 'approved-monotonic-claim',
        businessId: localSubscription.businessId,
        subscriptionId: localSubscription.id,
        provider: 'mercado_pago',
        environment: 'sandbox',
        status: 'approved',
        providerPaymentId: JULY_APPROVED.providerPaymentId,
        providerInvoiceId: JULY_APPROVED.id,
      }])

    await expect(reconcileSubscription(localSubscription.id, dependencies)).resolves.toMatchObject({
      outcome: 'reconciled', applied: 0,
    })
    expect(process).not.toHaveBeenCalled()
  })

  it('no marca reconciliación si la identidad financiera local cambia durante la red', async () => {
    const { dependencies } = createDependencies({ invoices: [] })
    ;(dependencies.prisma.businessSubscription.updateMany as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ count: 0 })

    await expect(reconcileSubscription(localSubscription.id, dependencies))
      .rejects.toMatchObject({ name: 'SubscriptionReconciliationValidationError' })
  })

  it('propaga timeout o cap excedido sin marcar reconciliación', async () => {
    const { dependencies, client, process } = createDependencies()
    client.searchInvoices.mockRejectedValueOnce(new Error('invoice history exceeds cap'))

    await expect(reconcileSubscription(localSubscription.id, dependencies))
      .rejects.toThrow('invoice history exceeds cap')
    expect(process).not.toHaveBeenCalled()
    expectNoSuccessfulReconciliation(dependencies)
  })

  it('falla cerrado ante un hueco mensual en el historial terminal', async () => {
    const { dependencies, process } = createDependencies({
      subscription: {
        ...providerSubscription,
        nextPaymentAt: new Date('2026-09-11T10:00:00.000Z'),
      },
      invoices: [JUNE_APPROVED],
    })

    await expect(reconcileSubscription(localSubscription.id, dependencies))
      .rejects.toMatchObject({ name: 'SubscriptionReconciliationValidationError' })
    expect(process).not.toHaveBeenCalled()
    expectNoSuccessfulReconciliation(dependencies)
  })

  it('drena 100 invoices con máximo tres refetches faltantes por corrida', async () => {
    const debitAt = (index: number) => new Date(Date.UTC(2018, index, 11, 10))
    const history = Array.from({ length: 100 }, (_, index) => invoice({
      id: `invoice-history-${String(index).padStart(3, '0')}`,
      status: 'approved',
      debitAt: debitAt(index).toISOString(),
      approvedAt: new Date(debitAt(index).getTime() + 60 * 60 * 1000).toISOString(),
    }))
    const durableClaims = new Map(history.slice(0, 94).map((item, index) => [item.id, {
      id: `claim-${index}`,
      businessId: localSubscription.businessId,
      subscriptionId: localSubscription.id,
      provider: 'mercado_pago',
      environment: 'sandbox',
      status: 'approved',
      providerPaymentId: item.providerPaymentId,
      providerInvoiceId: item.id,
    }]))
    const { dependencies, process } = createDependencies({
      subscription: { ...providerSubscription, nextPaymentAt: debitAt(100) },
      invoices: history,
    })
    ;(dependencies.prisma.subscriptionPayment.findMany as ReturnType<typeof vi.fn>)
      .mockImplementation(async () => [...durableClaims.values()])
    process.mockImplementation(async (event) => {
      const item = history.find((candidate) => candidate.id === event.resourceId)!
      durableClaims.set(item.id, {
        id: `claim-${item.id}`,
        businessId: localSubscription.businessId,
        subscriptionId: localSubscription.id,
        provider: 'mercado_pago',
        environment: 'sandbox',
        status: 'approved',
        providerPaymentId: item.providerPaymentId,
        providerInvoiceId: item.id,
      })
      return { outcome: 'applied' as const, status: 'active' }
    })

    await expect(reconcileSubscription(localSubscription.id, dependencies))
      .rejects.toMatchObject({ name: 'SubscriptionReconciliationPartialError' })
    expect(process).toHaveBeenCalledTimes(3)
    expectNoSuccessfulReconciliation(dependencies)

    await expect(reconcileSubscription(localSubscription.id, dependencies)).resolves.toMatchObject({
      outcome: 'reconciled', invoices: 100, applied: 3,
    })
    expect(process).toHaveBeenCalledTimes(6)
    expect(new Set(process.mock.calls.map(([event]) => event.resourceId)).size).toBe(6)
    expect(dependencies.prisma.businessSubscription.updateMany).toHaveBeenCalledTimes(1)
  })

  it('persiste refreshes failed y no repite los mismos tres hasta starvation', async () => {
    const failures = Array.from({ length: 4 }, (_, index) => ({
      ...invoice({
        id: `invoice-failed-refresh-${index}`,
        status: 'failed',
        debitAt: new Date(Date.UTC(2026, 4 + index, 11, 10)).toISOString(),
      }),
      providerStatus: 'cancelled',
    }))
    const durableClaims = new Map(failures.map((item, index) => [item.id, {
      id: `failed-claim-${index}`,
      businessId: localSubscription.businessId,
      subscriptionId: localSubscription.id,
      provider: 'mercado_pago',
      environment: 'sandbox',
      status: 'rejected',
      providerPaymentId: `persisted-failed-payment-${index}`,
      providerInvoiceId: item.id,
    }]))
    const { dependencies, process } = createDependencies({
      subscription: {
        ...providerSubscription,
        nextPaymentAt: new Date('2026-09-11T10:00:00.000Z'),
      },
      invoices: failures,
    })
    ;(dependencies.prisma.subscriptionPayment.findMany as ReturnType<typeof vi.fn>)
      .mockImplementation(async () => [...durableClaims.values()])
    process.mockImplementation(async (event) => {
      const claim = durableClaims.get(event.resourceId)!
      durableClaims.set(event.resourceId, { ...claim, status: 'cancelled' })
      return { outcome: 'duplicate' as const, status: 'past_due' }
    })

    await expect(reconcileSubscription(localSubscription.id, dependencies))
      .rejects.toMatchObject({ name: 'SubscriptionReconciliationPartialError' })
    await expect(reconcileSubscription(localSubscription.id, dependencies)).resolves.toMatchObject({
      outcome: 'reconciled', invoices: 4,
    })

    expect(process).toHaveBeenCalledTimes(4)
    expect(new Set(process.mock.calls.map(([event]) => event.resourceId)).size).toBe(4)
  })
})
