import { describe, expect, it, vi } from 'vitest'
import { deriveSubscriptionTransition, type SubscriptionState } from '@/lib/subscriptions/state-machine'
import {
  runSubscriptionBillingCron,
  type SubscriptionBillingCronDependencies,
} from './subscription-billing'

const NOW = new Date('2026-08-11T12:00:00.000Z')
const DAY = 24 * 60 * 60 * 1000

function candidate(overrides: Record<string, unknown> = {}) {
  return {
    id: `subscription-${Math.random()}`,
    businessId: 'business-safe-fixture',
    status: 'trialing' as const,
    interval: 'monthly' as const,
    currentPeriodStart: new Date('2026-07-12T12:00:00.000Z'),
    currentPeriodEnd: new Date('2026-08-12T12:00:00.000Z'),
    trialStartAt: new Date('2026-07-12T12:00:00.000Z'),
    trialEndAt: new Date('2026-08-12T12:00:00.000Z'),
    trialDays: 30,
    cancelledAt: null,
    suspendedAt: null,
    suspendedReason: null,
    nextBillingAt: null,
    lastPaidAt: null,
    pastDueAt: null,
    graceEndsAt: null,
    graceDays: 7,
    graceEnforcementDeferredAt: null,
    cancelAtPeriodEnd: false,
    cancellationRequestedAt: null,
    complimentaryUntil: null,
    provider: 'manual' as const,
    environment: null,
    providerSubscriptionId: null,
    lastReconciledAt: null,
    billingCronClaimedUntil: null,
    updatedAt: new Date('2026-08-10T12:00:00.000Z'),
    ...overrides,
  }
}

function createDependencies(rows: ReturnType<typeof candidate>[], enforcementEnabled = true) {
  const claimed = new Set<string>()
  const deliveries = new Set<string>()
  const applyTransition = vi.fn(async (_db, input) => {
    const row = rows.find((item) => item.id === input.subscriptionId)!
    const transition = deriveSubscriptionTransition({
      subscription: row as SubscriptionState,
      command: input.command,
    })
    return { applied: !transition.ignored, status: transition.nextStatus }
  })
  const dependencies = {
    prisma: {
      businessSubscription: {
        findMany: vi.fn().mockResolvedValue(rows),
        updateMany: vi.fn(async ({ where }) => {
          if (claimed.has(where.id)) return { count: 0 }
          claimed.add(where.id)
          return { count: 1 }
        }),
        findUnique: vi.fn(async ({ where }) => rows.find((row) => row.id === where.id) ?? null),
      },
      subscriptionNotificationDelivery: {
        createMany: vi.fn(async ({ data }) => {
          let count = 0
          for (const item of data) {
            if (!deliveries.has(item.dedupeKey)) {
              deliveries.add(item.dedupeKey)
              count++
            }
          }
          return { count }
        }),
      },
    },
    reconcile: vi.fn().mockResolvedValue({
      outcome: 'reconciled',
      invoices: 0,
      applied: 0,
      providerTerminalCanceled: false,
    }),
    applyTransition,
    enforcementEnabled: () => enforcementEnabled,
  } as unknown as SubscriptionBillingCronDependencies
  return { dependencies, applyTransition }
}

describe('runSubscriptionBillingCron', () => {
  it('crea una sola entrega idempotente para cada aviso de 7, 3 y 1 días', async () => {
    const rows = [7, 3, 1].map((days) => candidate({
      id: `subscription-${days}`,
      trialEndAt: new Date(NOW.getTime() + days * DAY),
      currentPeriodEnd: new Date(NOW.getTime() + days * DAY),
    }))
    const { dependencies } = createDependencies(rows)

    await expect(runSubscriptionBillingCron({ now: NOW }, dependencies)).resolves.toMatchObject({
      processed: 3,
      notified: 3,
      errors: 0,
    })
    await runSubscriptionBillingCron({ now: NOW }, dependencies)

    expect(dependencies.prisma.subscriptionNotificationDelivery.createMany).toHaveBeenCalledTimes(3)
    const kinds = (dependencies.prisma.subscriptionNotificationDelivery.createMany as ReturnType<typeof vi.fn>)
      .mock.calls.flatMap(([input]) => input.data.map((item: { kind: string }) => item.kind))
    expect(kinds).toEqual([
      'subscription_due_7_days',
      'subscription_due_3_days',
      'subscription_due_1_day',
    ])
    expect(dependencies.prisma.businessSubscription.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 5 }),
    )
  })

  it('usa el fin de la exención vigente para sus avisos de 7, 3 y 1 días', async () => {
    const row = candidate({
      id: 'complimentary-subscription',
      complimentaryUntil: new Date(NOW.getTime() + 7 * DAY),
      trialEndAt: null,
    })
    const { dependencies } = createDependencies([row])

    await expect(runSubscriptionBillingCron({ now: NOW }, dependencies)).resolves.toMatchObject({
      notified: 1,
    })
    expect(dependencies.prisma.subscriptionNotificationDelivery.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({
        kind: 'subscription_due_7_days',
        effectiveDate: row.complimentaryUntil,
      })],
      skipDuplicates: true,
    })
  })

  it.each([
    ['trial vencido', candidate({ trialEndAt: NOW, currentPeriodEnd: NOW }), true, 'past_due'],
    ['exención vencida', candidate({ complimentaryUntil: NOW, trialStartAt: null, trialEndAt: null }), true, 'trialing'],
    ['grace vigente', candidate({ status: 'past_due', pastDueAt: NOW, graceEndsAt: new Date(NOW.getTime() + DAY) }), true, 'past_due'],
    ['grace vencida enforcement off', candidate({ status: 'past_due', pastDueAt: new Date(NOW.getTime() - 8 * DAY), graceEndsAt: NOW }), false, 'past_due'],
    ['grace vencida enforcement on', candidate({ status: 'past_due', pastDueAt: new Date(NOW.getTime() - 8 * DAY), graceEndsAt: NOW }), true, 'suspended'],
    ['cancelación al cierre', candidate({ status: 'active', cancelAtPeriodEnd: true, currentPeriodEnd: NOW }), true, 'cancelled'],
  ])('%s aplica reglas temporales con el reloj inyectado', async (_label, row, enforcement, expected) => {
    const { dependencies, applyTransition } = createDependencies([row], enforcement)

    const result = await runSubscriptionBillingCron({ now: NOW }, dependencies)

    expect(applyTransition).toHaveBeenCalledWith(dependencies.prisma, {
      subscriptionId: row.id,
      command: {
        type: 'time_elapsed',
        at: NOW,
        enforcementEnabled: enforcement,
        providerCancellationConfirmed: false,
      },
    })
    expect((await applyTransition.mock.results[0].value).status).toBe(expected)
    expect(result.suspended).toBe(expected === 'suspended' ? 1 : 0)
  })

  it('reconcilia un webhook perdido antes de evaluar la gracia y no suspende el pago reparado', async () => {
    const stale = candidate({
      status: 'past_due',
      provider: 'mercado_pago',
      environment: 'sandbox',
      providerSubscriptionId: 'provider-subscription',
      pastDueAt: new Date(NOW.getTime() - 8 * DAY),
      graceEndsAt: NOW,
    })
    const repaired = { ...stale, status: 'active' as const, pastDueAt: null, graceEndsAt: null, lastPaidAt: NOW }
    const { dependencies, applyTransition } = createDependencies([stale])
    ;(dependencies.prisma.businessSubscription.findUnique as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(repaired)
    applyTransition.mockResolvedValueOnce({ applied: false, status: 'active' })

    await expect(runSubscriptionBillingCron({ now: NOW }, dependencies)).resolves.toMatchObject({
      processed: 1,
      reconciled: 1,
      suspended: 0,
      errors: 0,
    })
    expect(dependencies.reconcile).toHaveBeenCalledWith(stale.id)
  })

  it('sólo permite cancelación local MP con evidencia terminal de esta corrida', async () => {
    const row = candidate({
      status: 'active',
      cancelAtPeriodEnd: true,
      currentPeriodEnd: NOW,
      provider: 'mercado_pago',
      environment: 'sandbox',
      providerSubscriptionId: 'provider-subscription',
    })
    const { dependencies, applyTransition } = createDependencies([row])

    await runSubscriptionBillingCron({ now: NOW }, dependencies)
    expect(applyTransition).toHaveBeenLastCalledWith(dependencies.prisma, {
      subscriptionId: row.id,
      command: {
        type: 'time_elapsed',
        at: NOW,
        enforcementEnabled: true,
        providerCancellationConfirmed: false,
      },
    })
    expect((await applyTransition.mock.results[0].value).status).toBe('active')

    dependencies.reconcile = vi.fn().mockResolvedValue({
      outcome: 'reconciled',
      invoices: 0,
      applied: 0,
      providerTerminalCanceled: true,
    })
    ;(dependencies.prisma.businessSubscription.findMany as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([row])
    ;(dependencies.prisma.businessSubscription.updateMany as ReturnType<typeof vi.fn>)
      .mockResolvedValue({ count: 1 })

    await runSubscriptionBillingCron({ now: NOW }, dependencies)
    expect(applyTransition).toHaveBeenLastCalledWith(dependencies.prisma, {
      subscriptionId: row.id,
      expectedCancellationProviderSnapshot: {
        provider: 'mercado_pago',
        environment: 'sandbox',
        providerSubscriptionId: 'provider-subscription',
      },
      command: {
        type: 'time_elapsed',
        at: NOW,
        enforcementEnabled: true,
        providerCancellationConfirmed: true,
      },
    })
    expect((await applyTransition.mock.results[1].value).status).toBe('cancelled')
  })

  it('si la reconciliación externa es ambigua no degrada el estado con reglas temporales', async () => {
    const row = candidate({
      status: 'past_due',
      provider: 'mercado_pago',
      environment: 'sandbox',
      providerSubscriptionId: 'provider-subscription',
      graceEndsAt: NOW,
    })
    const { dependencies, applyTransition } = createDependencies([row])
    dependencies.reconcile = vi.fn().mockRejectedValue(new Error('timeout'))

    await expect(runSubscriptionBillingCron({ now: NOW }, dependencies)).resolves.toMatchObject({
      processed: 1,
      reconciled: 0,
      suspended: 0,
      errors: 1,
    })
    expect(applyTransition).not.toHaveBeenCalled()
  })

  it('dos corridas simultáneas reclaman la fila con CAS y no duplican efectos', async () => {
    const row = candidate({ trialEndAt: NOW, currentPeriodEnd: NOW })
    const { dependencies, applyTransition } = createDependencies([row])

    const [first, second] = await Promise.all([
      runSubscriptionBillingCron({ now: NOW }, dependencies),
      runSubscriptionBillingCron({ now: NOW }, dependencies),
    ])

    expect(first.processed + second.processed).toBe(1)
    expect(applyTransition).toHaveBeenCalledTimes(1)
  })

  it('un lease persistente impide que una corrida iniciada después del claim repita la red', async () => {
    const row = candidate({
      provider: 'mercado_pago',
      environment: 'sandbox',
      providerSubscriptionId: 'provider-subscription',
    })
    let leaseUntil: Date | null = null
    let releaseReconciliation!: () => void
    const reconciliationPending = new Promise<void>((resolve) => { releaseReconciliation = resolve })
    const { dependencies } = createDependencies([row])
    ;(dependencies.prisma.businessSubscription.findMany as ReturnType<typeof vi.fn>)
      .mockImplementation(async () => leaseUntil && leaseUntil > NOW ? [] : [row])
    ;(dependencies.prisma.businessSubscription.updateMany as ReturnType<typeof vi.fn>)
      .mockImplementation(async ({ data }) => {
        if (data.billingCronClaimedUntil instanceof Date) {
          if (leaseUntil && leaseUntil > NOW) return { count: 0 }
          leaseUntil = data.billingCronClaimedUntil
          return { count: 1 }
        }
        if (data.billingCronClaimedUntil === null) leaseUntil = null
        return { count: 1 }
      })
    dependencies.reconcile = vi.fn().mockImplementation(() => reconciliationPending)

    const first = runSubscriptionBillingCron({ now: NOW }, dependencies)
    await vi.waitFor(() => expect(dependencies.reconcile).toHaveBeenCalledTimes(1))
    const secondPending = runSubscriptionBillingCron({ now: NOW }, dependencies)
    await new Promise((resolve) => setTimeout(resolve, 0))
    releaseReconciliation()
    const [, second] = await Promise.all([first, secondPending])

    expect(second.processed).toBe(0)
    expect(dependencies.reconcile).toHaveBeenCalledTimes(1)
  })

  it('aísla un error de claim y procesa/libera los claims exitosos', async () => {
    const first = candidate({ id: 'first-candidate', trialEndAt: NOW, currentPeriodEnd: NOW })
    const second = candidate({ id: 'second-candidate', trialEndAt: NOW, currentPeriodEnd: NOW })
    const third = candidate({ id: 'third-candidate', trialEndAt: NOW, currentPeriodEnd: NOW })
    const { dependencies, applyTransition } = createDependencies([first, second, third])
    const updateMany = dependencies.prisma.businessSubscription.updateMany as ReturnType<typeof vi.fn>
    updateMany.mockImplementation(async ({ where, data }) => {
      if (where.id === second.id && data.billingCronClaimedUntil instanceof Date) {
        throw new Error('claim unavailable')
      }
      return { count: 1 }
    })

    await expect(runSubscriptionBillingCron({ now: NOW }, dependencies)).resolves.toMatchObject({
      processed: 2,
      errors: 1,
    })
    expect(applyTransition.mock.calls.map(([, input]) => input.subscriptionId)).toEqual([
      first.id,
      third.id,
    ])
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: first.id,
        billingCronClaimedUntil: new Date(NOW.getTime() + 5 * 60 * 1000),
      },
      data: { billingCronClaimedUntil: null },
    })
  })
})
