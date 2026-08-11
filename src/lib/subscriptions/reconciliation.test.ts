import { describe, expect, it, vi } from 'vitest'
import type { MpInvoice, MpSubscription } from './mercado-pago-mappers'
import {
  reconcileSubscription,
  type ReconciliationDependencies,
} from './reconciliation'

const now = new Date('2026-08-11T12:00:00.000Z')
const localSubscription = {
  id: 'subscription-local',
  businessId: 'business-local',
  status: 'past_due' as const,
  provider: 'mercado_pago' as const,
  environment: 'sandbox' as const,
  providerSubscriptionId: 'provider-subscription',
  providerPlanId: 'provider-plan',
  amount: 15_000,
  currency: 'CLP',
  currentPeriodEnd: new Date('2026-08-12T12:00:00.000Z'),
  lastPaidAt: null,
}
const providerSubscription: MpSubscription = {
  id: 'provider-subscription',
  status: 'active',
  providerStatus: 'authorized',
  collectorId: 'provider-account',
  planId: 'provider-plan',
  externalReference: 'opaque-reference',
  checkoutUrl: null,
  amount: 15_000,
  currency: 'CLP',
  frequency: 1,
  frequencyType: 'months',
  nextPaymentAt: new Date('2026-09-11T12:00:00.000Z'),
  updatedAt: new Date('2026-08-11T11:00:00.000Z'),
}
const approvedInvoice: MpInvoice = {
  id: 'provider-invoice',
  subscriptionId: providerSubscription.id,
  status: 'approved',
  providerPaymentId: 'provider-payment',
  providerStatus: 'approved',
  amount: 15_000,
  currency: 'CLP',
  externalReference: 'opaque-reference',
  approvedAt: new Date('2026-08-11T10:00:00.000Z'),
  createdAt: new Date('2026-08-11T09:59:00.000Z'),
  updatedAt: new Date('2026-08-11T10:00:00.000Z'),
  debitAt: new Date('2026-08-11T10:00:00.000Z'),
}

function createDependencies(overrides: {
  subscription?: MpSubscription
  invoices?: MpInvoice[]
} = {}) {
  const process = vi.fn().mockResolvedValue({ outcome: 'applied', status: 'active' })
  const client = {
    getSubscription: vi.fn().mockResolvedValue(overrides.subscription ?? providerSubscription),
    searchInvoices: vi.fn().mockResolvedValue(overrides.invoices ?? [approvedInvoice]),
  }
  const dependencies = {
    prisma: {
      businessSubscription: {
        findUnique: vi.fn().mockResolvedValue(localSubscription),
        update: vi.fn().mockResolvedValue({}),
      },
      subscriptionPayment: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    },
    getProcessor: vi.fn().mockReturnValue({ client, process }),
    now: () => now,
  } as unknown as ReconciliationDependencies
  return { dependencies, client, process }
}

describe('reconcileSubscription', () => {
  it('repara una factura aprobada cuyo webhook se perdió usando el procesador autoritativo', async () => {
    const { dependencies, client, process } = createDependencies()

    await expect(reconcileSubscription(localSubscription.id, dependencies)).resolves.toEqual({
      outcome: 'reconciled',
      invoices: 1,
      applied: 1,
    })

    expect(client.getSubscription).toHaveBeenCalledWith(providerSubscription.id)
    expect(client.searchInvoices).toHaveBeenCalledWith(providerSubscription.id)
    expect(process).toHaveBeenCalledWith({
      topic: 'subscription_authorized_payment',
      resourceId: approvedInvoice.id,
      liveMode: false,
    })
    expect(dependencies.prisma.businessSubscription.update).toHaveBeenCalledWith({
      where: { id: localSubscription.id },
      data: { lastReconciledAt: now },
    })
  })

  it('un timeout no ejecuta reparación ni marca la reconciliación como exitosa', async () => {
    const { dependencies, client, process } = createDependencies()
    client.searchInvoices.mockRejectedValueOnce(new Error('timeout'))

    await expect(reconcileSubscription(localSubscription.id, dependencies)).rejects.toThrow('timeout')

    expect(process).not.toHaveBeenCalled()
    expect(dependencies.prisma.businessSubscription.update).not.toHaveBeenCalled()
  })

  it('un snapshot externo incompleto se rechaza antes de cualquier transición', async () => {
    const { dependencies, process } = createDependencies({
      subscription: { ...providerSubscription, planId: null },
    })

    await expect(reconcileSubscription(localSubscription.id, dependencies)).rejects.toMatchObject({
      name: 'SubscriptionReconciliationValidationError',
    })

    expect(process).not.toHaveBeenCalled()
    expect(dependencies.prisma.businessSubscription.update).not.toHaveBeenCalled()
  })

  it('delega una factura fallida antigua sin escribir estado local por su cuenta', async () => {
    const oldFailure: MpInvoice = {
      ...approvedInvoice,
      id: 'old-failed-invoice',
      status: 'failed',
      providerPaymentId: null,
      providerStatus: 'rejected',
      approvedAt: null,
      debitAt: new Date('2026-07-01T00:00:00.000Z'),
    }
    const { dependencies, process } = createDependencies({ invoices: [oldFailure] })
    process.mockResolvedValueOnce({ outcome: 'duplicate', status: 'active' })

    await expect(reconcileSubscription(localSubscription.id, dependencies)).resolves.toEqual({
      outcome: 'reconciled',
      invoices: 1,
      applied: 0,
    })

    expect(process).toHaveBeenCalledWith({
      topic: 'subscription_authorized_payment',
      resourceId: oldFailure.id,
      liveMode: false,
    })
    expect(dependencies.prisma.businessSubscription.update).toHaveBeenCalledTimes(1)
  })

  it('procesa sólo el terminal observable más reciente y no replayea aprobaciones históricas', async () => {
    const oldApproved = {
      ...approvedInvoice,
      id: 'old-approved-invoice',
      approvedAt: new Date('2026-06-11T10:00:00.000Z'),
      debitAt: new Date('2026-06-11T10:00:00.000Z'),
    }
    const middleFailure: MpInvoice = {
      ...approvedInvoice,
      id: 'middle-failed-invoice',
      status: 'failed',
      providerPaymentId: null,
      providerStatus: 'rejected',
      approvedAt: null,
      debitAt: new Date('2026-07-11T10:00:00.000Z'),
    }
    const newestApproved = {
      ...approvedInvoice,
      id: 'newest-approved-invoice',
    }
    const { dependencies, process } = createDependencies({
      invoices: [newestApproved, oldApproved, middleFailure],
    })

    await expect(reconcileSubscription(localSubscription.id, dependencies)).resolves.toMatchObject({
      invoices: 1,
      applied: 1,
    })

    expect(process).toHaveBeenCalledTimes(1)
    expect(process).toHaveBeenCalledWith(expect.objectContaining({ resourceId: newestApproved.id }))
  })

  it('no aplica un aprobado si el próximo cobro no representa un ciclo mensual verificable', async () => {
    const { dependencies, process } = createDependencies({
      subscription: {
        ...providerSubscription,
        nextPaymentAt: new Date('2026-08-20T10:00:00.000Z'),
      },
    })

    await expect(reconcileSubscription(localSubscription.id, dependencies)).rejects.toMatchObject({
      name: 'SubscriptionReconciliationValidationError',
    })
    expect(process).not.toHaveBeenCalled()
  })

  it('acepta una aprobación tardía cuando debitAt mantiene el ciclo mensual verificable', async () => {
    const lateApproval = {
      ...approvedInvoice,
      approvedAt: new Date('2026-08-25T10:00:00.000Z'),
    }
    const { dependencies, process } = createDependencies({ invoices: [lateApproval] })

    await expect(reconcileSubscription(localSubscription.id, dependencies)).resolves.toMatchObject({
      invoices: 1,
      applied: 1,
    })
    expect(process).toHaveBeenCalledWith(expect.objectContaining({ resourceId: lateApproval.id }))
  })

  it('una cancelación externa con un aprobado no reclamado queda ambigua y no corta acceso', async () => {
    const { dependencies, process } = createDependencies({
      subscription: {
        ...providerSubscription,
        status: 'canceled',
        providerStatus: 'canceled',
        nextPaymentAt: null,
      },
    })

    await expect(reconcileSubscription(localSubscription.id, dependencies)).rejects.toMatchObject({
      name: 'SubscriptionReconciliationValidationError',
    })
    expect(process).not.toHaveBeenCalled()
    expect(dependencies.prisma.businessSubscription.update).not.toHaveBeenCalled()
  })

  it('una cancelación externa avanza cuando el último aprobado ya pertenece a la suscripción', async () => {
    const { dependencies, process } = createDependencies({
      subscription: {
        ...providerSubscription,
        status: 'canceled',
        providerStatus: 'canceled',
        nextPaymentAt: null,
      },
    })
    ;(dependencies.prisma.subscriptionPayment.findMany as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([{
        id: 'local-payment-claim',
        businessId: localSubscription.businessId,
        subscriptionId: localSubscription.id,
        provider: 'mercado_pago',
        environment: 'sandbox',
      }])

    await expect(reconcileSubscription(localSubscription.id, dependencies)).resolves.toMatchObject({
      invoices: 0,
      applied: 1,
    })
    expect(process).toHaveBeenCalledTimes(1)
    expect(process).toHaveBeenCalledWith({
      topic: 'subscription_preapproval',
      resourceId: providerSubscription.id,
      liveMode: false,
    })
  })

  it('un invoice pending más reciente impide degradar la suscripción por tiempo', async () => {
    const pending = {
      ...approvedInvoice,
      id: 'pending-invoice',
      status: 'pending' as const,
      providerPaymentId: null,
      providerStatus: 'pending',
      approvedAt: null,
      debitAt: new Date('2026-08-12T10:00:00.000Z'),
    }
    const { dependencies, process } = createDependencies({ invoices: [approvedInvoice, pending] })

    await expect(reconcileSubscription(localSubscription.id, dependencies)).rejects.toMatchObject({
      name: 'SubscriptionReconciliationValidationError',
    })
    expect(process).not.toHaveBeenCalled()
  })

  it('una cancelación inspecciona aprobados históricos aunque el terminal sea fallido', async () => {
    const laterFailure: MpInvoice = {
      ...approvedInvoice,
      id: 'later-failed-invoice',
      status: 'failed',
      providerPaymentId: null,
      providerStatus: 'rejected',
      approvedAt: null,
      debitAt: new Date('2026-08-12T10:00:00.000Z'),
    }
    const { dependencies, process } = createDependencies({
      subscription: {
        ...providerSubscription,
        status: 'canceled',
        providerStatus: 'canceled',
        nextPaymentAt: null,
      },
      invoices: [approvedInvoice, laterFailure],
    })

    await expect(reconcileSubscription(localSubscription.id, dependencies)).rejects.toMatchObject({
      name: 'SubscriptionReconciliationValidationError',
    })
    expect(process).not.toHaveBeenCalled()
  })
})
