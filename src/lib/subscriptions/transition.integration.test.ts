import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db'
import { requireTestDatabase } from '../../../tests/integration/setup'
import {
  applySubscriptionTransition,
  SubscriptionProviderPaymentOwnershipConflictError,
  SubscriptionTransitionConflictError,
} from './transition'

requireTestDatabase()

const PLAN = 'subscription-transition-plan'
const BUSINESS = 'subscription-transition-business'
const OTHER_BUSINESS = 'subscription-transition-other-business'
const SUBSCRIPTION = 'subscription-transition-subscription'
const OTHER_SUBSCRIPTION = 'subscription-transition-other-subscription'
const PERIOD_END = new Date('2026-09-01T00:00:00.000Z')
const PAID_AT = new Date('2026-08-15T12:00:00.000Z')
const concurrentPrisma = new PrismaClient()

async function cleanup() {
  const businessIds = [BUSINESS, OTHER_BUSINESS]
  await prisma.subscriptionPayment.deleteMany({ where: { businessId: { in: businessIds } } })
  await prisma.subscriptionLog.deleteMany({ where: { businessId: { in: businessIds } } })
  await prisma.businessSubscription.deleteMany({ where: { businessId: { in: businessIds } } })
  await prisma.business.deleteMany({ where: { id: { in: businessIds } } })
  await prisma.plan.deleteMany({ where: { id: PLAN } })
}

async function resetSubscription() {
  const businessIds = [BUSINESS, OTHER_BUSINESS]
  await prisma.subscriptionPayment.deleteMany({ where: { businessId: { in: businessIds } } })
  await prisma.subscriptionLog.deleteMany({ where: { businessId: { in: businessIds } } })
  await prisma.business.updateMany({
    where: { id: { in: businessIds } },
    data: { subscriptionStatus: 'past_due' },
  })
  await prisma.businessSubscription.updateMany({
    where: { id: { in: [SUBSCRIPTION, OTHER_SUBSCRIPTION] } },
    data: {
      status: 'past_due',
      interval: 'monthly',
      planId: PLAN,
      amount: 14990,
      currency: 'CLP',
      currentPeriodStart: new Date('2026-08-01T00:00:00.000Z'),
      currentPeriodEnd: PERIOD_END,
      lastPaidAt: null,
      nextBillingAt: null,
      pastDueAt: new Date('2026-08-10T00:00:00.000Z'),
      graceEndsAt: new Date('2026-08-17T00:00:00.000Z'),
      graceEnforcementDeferredAt: null,
      suspendedAt: null,
      suspendedReason: null,
      cancelAtPeriodEnd: false,
      cancellationRequestedAt: null,
      cancelledAt: null,
    },
  })
}

beforeAll(async () => {
  await cleanup()
  await prisma.plan.create({
    data: { id: PLAN, name: PLAN, priceMonthly: 14990, priceYearly: 149900 },
  })
  await prisma.business.createMany({
    data: [{
      id: BUSINESS,
      name: 'Subscription Transition',
      slug: BUSINESS,
      subdomain: BUSINESS,
      ownerUserId: 'subscription-transition-owner',
      city: 'Santiago',
      subscriptionStatus: 'past_due',
      planId: PLAN,
    }, {
      id: OTHER_BUSINESS,
      name: 'Subscription Transition Other',
      slug: OTHER_BUSINESS,
      subdomain: OTHER_BUSINESS,
      ownerUserId: 'subscription-transition-other-owner',
      city: 'Santiago',
      subscriptionStatus: 'past_due',
      planId: PLAN,
    }],
  })
  await prisma.businessSubscription.createMany({
    data: [{
      id: SUBSCRIPTION,
      businessId: BUSINESS,
      planId: PLAN,
      status: 'past_due',
      amount: 14990,
      currency: 'CLP',
      provider: 'mercado_pago',
      environment: 'sandbox',
      providerPlanId: 'subscription-transition-provider-plan',
      providerSubscriptionId: 'subscription-transition-provider-id',
      currentPeriodStart: new Date('2026-08-01T00:00:00.000Z'),
      currentPeriodEnd: PERIOD_END,
      pastDueAt: new Date('2026-08-10T00:00:00.000Z'),
      graceEndsAt: new Date('2026-08-17T00:00:00.000Z'),
      billingEnabled: true,
    }, {
      id: OTHER_SUBSCRIPTION,
      businessId: OTHER_BUSINESS,
      planId: PLAN,
      status: 'past_due',
      amount: 14990,
      currency: 'CLP',
      provider: 'mercado_pago',
      environment: 'sandbox',
      providerPlanId: 'subscription-transition-other-provider-plan',
      providerSubscriptionId: 'subscription-transition-other-provider-id',
      currentPeriodStart: new Date('2026-08-01T00:00:00.000Z'),
      currentPeriodEnd: PERIOD_END,
      pastDueAt: new Date('2026-08-10T00:00:00.000Z'),
      graceEndsAt: new Date('2026-08-17T00:00:00.000Z'),
      billingEnabled: true,
    }],
  })
})

beforeEach(resetSubscription)

afterAll(async () => {
  await cleanup()
  await concurrentPrisma.$disconnect()
  await prisma.$disconnect()
})

function approvedCommand(
  providerPaymentId: string,
  providerInvoiceId = `invoice-${providerPaymentId}`,
  periodEnd = new Date('2026-10-01T00:00:00.000Z'),
  subscriptionId = SUBSCRIPTION,
) {
  return {
    subscriptionId,
    command: {
      type: 'invoice_approved' as const,
      providerPaymentId,
      paidAt: PAID_AT,
      periodEnd,
    },
    payment: {
      providerInvoiceId,
      providerStatus: 'approved',
      providerUpdatedAt: PAID_AT,
    },
  }
}

function failedCommand(providerInvoiceId: string) {
  return {
    subscriptionId: SUBSCRIPTION,
    command: {
      type: 'invoice_failed' as const,
      occurredAt: PAID_AT,
    },
    payment: {
      providerPaymentId: `failed-${providerInvoiceId}`,
      providerInvoiceId,
      providerStatus: 'rejected',
      providerUpdatedAt: PAID_AT,
    },
  }
}

describe('applySubscriptionTransition', () => {
  it('reclama un fallo terminal una vez y reconoce el retry del mismo owner', async () => {
    await prisma.businessSubscription.update({
      where: { id: SUBSCRIPTION },
      data: {
        status: 'active',
        currentPeriodStart: new Date('2026-07-15T12:00:00.000Z'),
        currentPeriodEnd: PAID_AT,
        pastDueAt: null,
        graceEndsAt: null,
      },
    })
    await prisma.business.update({
      where: { id: BUSINESS },
      data: { subscriptionStatus: 'active' },
    })

    await expect(applySubscriptionTransition(
      prisma,
      failedCommand('invoice-failed-retry'),
    )).resolves.toMatchObject({ applied: true, status: 'past_due' })
    await expect(applySubscriptionTransition(
      prisma,
      failedCommand('invoice-failed-retry'),
    )).resolves.toEqual({ applied: false, status: 'past_due' })

    await expect(prisma.subscriptionPayment.findMany({
      where: { providerInvoiceId: 'invoice-failed-retry' },
    })).resolves.toEqual([
      expect.objectContaining({
        businessId: BUSINESS,
        subscriptionId: SUBSCRIPTION,
        status: 'rejected',
      }),
    ])
  })

  it('promueve monotónicamente el mismo invoice de rejected a approved', async () => {
    await prisma.businessSubscription.update({
      where: { id: SUBSCRIPTION },
      data: { status: 'active', pastDueAt: null, graceEndsAt: null },
    })
    await applySubscriptionTransition(prisma, failedCommand('invoice-retry-approved'))

    await expect(applySubscriptionTransition(
      prisma,
      approvedCommand('payment-retry-approved', 'invoice-retry-approved'),
    )).resolves.toMatchObject({ applied: true, status: 'active' })

    await expect(prisma.subscriptionPayment.findMany({
      where: { providerInvoiceId: 'invoice-retry-approved' },
    })).resolves.toEqual([
      expect.objectContaining({
        status: 'approved',
        providerPaymentId: 'payment-retry-approved',
        paidAt: PAID_AT,
      }),
    ])
  })

  it('promueve el approved aunque compita desde cero con el failed del mismo invoice', async () => {
    await prisma.businessSubscription.update({
      where: { id: SUBSCRIPTION },
      data: {
        status: 'active',
        currentPeriodStart: new Date('2026-07-15T12:00:00.000Z'),
        currentPeriodEnd: PAID_AT,
        pastDueAt: null,
        graceEndsAt: null,
      },
    })
    let approvedReachedInsert!: () => void
    let failedInserted!: () => void
    const approvedReady = new Promise<void>((resolve) => { approvedReachedInsert = resolve })
    const failedReady = new Promise<void>((resolve) => { failedInserted = resolve })
    const approvedPrisma = prisma.$extends({
      query: {
        subscriptionPayment: {
          async createMany({ args, query }) {
            approvedReachedInsert()
            await failedReady
            return query(args)
          },
        },
      },
    })
    const failedPrisma = concurrentPrisma.$extends({
      query: {
        subscriptionPayment: {
          async createMany({ args, query }) {
            const result = await query(args)
            failedInserted()
            return result
          },
        },
      },
    })

    const approvedInput = approvedCommand(
      'payment-racing-approved',
      'invoice-racing-terminal',
      new Date('2026-09-15T12:00:00.000Z'),
    )
    const approved = applySubscriptionTransition(
      approvedPrisma as unknown as PrismaClient,
      approvedInput,
    ).catch((error) => {
      if (!(error instanceof SubscriptionTransitionConflictError)) throw error
      return applySubscriptionTransition(prisma, approvedInput)
    })
    await approvedReady
    const failed = applySubscriptionTransition(
      failedPrisma as unknown as PrismaClient,
      failedCommand('invoice-racing-terminal'),
    )

    await expect(Promise.all([approved, failed])).resolves.toEqual([
      expect.objectContaining({ applied: true, status: 'active' }),
      expect.objectContaining({ applied: true, status: 'past_due' }),
    ])
    await expect(prisma.subscriptionPayment.findMany({
      where: { providerInvoiceId: 'invoice-racing-terminal' },
    })).resolves.toEqual([
      expect.objectContaining({
        status: 'approved',
        providerPaymentId: 'payment-racing-approved',
      }),
    ])
    await expect(prisma.businessSubscription.findUniqueOrThrow({
      where: { id: SUBSCRIPTION },
    })).resolves.toMatchObject({ status: 'active' })
  })

  it('persiste una sola auditoría para gracia vencida con enforcement apagado', async () => {
    const at = new Date('2026-08-18T00:00:00.000Z')
    const command = {
      subscriptionId: SUBSCRIPTION,
      command: { type: 'time_elapsed' as const, at, enforcementEnabled: false },
    }

    await expect(applySubscriptionTransition(prisma, command)).resolves.toMatchObject({
      applied: true,
      status: 'past_due',
    })
    await expect(applySubscriptionTransition(prisma, {
      ...command,
      command: { ...command.command, at: new Date('2026-08-19T00:00:00.000Z') },
    })).resolves.toMatchObject({ applied: false, status: 'past_due' })

    await expect(prisma.businessSubscription.findUniqueOrThrow({
      where: { id: SUBSCRIPTION },
    })).resolves.toMatchObject({ graceEnforcementDeferredAt: at })
    await expect(prisma.subscriptionLog.findMany({
      where: { businessId: BUSINESS },
    })).resolves.toEqual([
      expect.objectContaining({ action: 'grace_expired_unenforced' }),
    ])
  })

  it('la cancelación admin mantiene entitlement hasta currentPeriodEnd', async () => {
    await prisma.businessSubscription.update({
      where: { id: SUBSCRIPTION },
      data: { status: 'active' },
    })
    await prisma.business.update({
      where: { id: BUSINESS },
      data: { subscriptionStatus: 'active' },
    })

    await applySubscriptionTransition(prisma, {
      subscriptionId: SUBSCRIPTION,
      command: {
        type: 'admin_cancel',
        occurredAt: PAID_AT,
        reason: 'requested-by-owner',
      },
    })

    const [subscription, business, logs] = await Promise.all([
      prisma.businessSubscription.findUniqueOrThrow({ where: { id: SUBSCRIPTION } }),
      prisma.business.findUniqueOrThrow({ where: { id: BUSINESS } }),
      prisma.subscriptionLog.findMany({ where: { businessId: BUSINESS } }),
    ])
    expect(subscription).toMatchObject({
      status: 'active',
      cancelAtPeriodEnd: true,
      cancellationRequestedAt: PAID_AT,
      cancelledAt: null,
    })
    expect(business.subscriptionStatus).toBe('active')
    expect(logs).toEqual([
      expect.objectContaining({
        action: 'subscription_cancellation_requested_by_admin',
        beforeStatus: 'active',
        afterStatus: 'active',
      }),
    ])
  })

  it('rechaza también comandos admin sobre una suscripción no mensual', async () => {
    await prisma.businessSubscription.update({
      where: { id: SUBSCRIPTION },
      data: { interval: 'yearly' },
    })

    await expect(applySubscriptionTransition(prisma, {
      subscriptionId: SUBSCRIPTION,
      command: { type: 'admin_activate', occurredAt: PAID_AT },
    })).rejects.toThrow(/monthly/)

    await expect(prisma.businessSubscription.findUniqueOrThrow({
      where: { id: SUBSCRIPTION },
    })).resolves.toMatchObject({ status: 'past_due', interval: 'yearly' })
    await expect(prisma.subscriptionLog.count({
      where: { businessId: BUSINESS },
    })).resolves.toBe(0)
  })

  it('confirma suscripción, estado compatible, pago y log en una transacción', async () => {
    await applySubscriptionTransition(prisma, approvedCommand('payment-atomic'))

    const [subscription, business, payments, logs] = await Promise.all([
      prisma.businessSubscription.findUniqueOrThrow({ where: { id: SUBSCRIPTION } }),
      prisma.business.findUniqueOrThrow({ where: { id: BUSINESS } }),
      prisma.subscriptionPayment.findMany({ where: { businessId: BUSINESS } }),
      prisma.subscriptionLog.findMany({ where: { businessId: BUSINESS } }),
    ])

    expect(subscription).toMatchObject({
      status: 'active',
      lastPaidAt: PAID_AT,
      pastDueAt: null,
      graceEndsAt: null,
    })
    expect(business.subscriptionStatus).toBe('active')
    expect(payments).toEqual([
      expect.objectContaining({
        providerPaymentId: 'payment-atomic',
        providerInvoiceId: 'invoice-payment-atomic',
        status: 'approved',
        amount: 14990,
        currency: 'CLP',
      }),
    ])
    expect(logs).toEqual([
      expect.objectContaining({
        action: 'subscription_recovered',
        beforeStatus: 'past_due',
        afterStatus: 'active',
      }),
    ])
  })

  it('un aprobado duplicado no vuelve a avanzar el período ni duplica efectos', async () => {
    await applySubscriptionTransition(prisma, approvedCommand('payment-duplicate'))
    await applySubscriptionTransition(
      prisma,
      approvedCommand(
        'payment-duplicate',
        'invoice-payment-duplicate',
        new Date('2026-11-01T00:00:00.000Z'),
      ),
    )

    const [subscription, paymentCount, logCount] = await Promise.all([
      prisma.businessSubscription.findUniqueOrThrow({ where: { id: SUBSCRIPTION } }),
      prisma.subscriptionPayment.count({ where: { businessId: BUSINESS } }),
      prisma.subscriptionLog.count({ where: { businessId: BUSINESS } }),
    ])

    expect(subscription.currentPeriodEnd).toEqual(new Date('2026-10-01T00:00:00.000Z'))
    expect(paymentCount).toBe(1)
    expect(logCount).toBe(1)
  })

  it('un duplicado tardío conserva idempotencia aunque el primer commit cambie updatedAt', async () => {
    const before = await prisma.businessSubscription.findUniqueOrThrow({
      where: { id: SUBSCRIPTION },
    })
    const command = {
      ...approvedCommand('payment-delayed-duplicate'),
      expectedProviderSnapshot: {
        provider: 'mercado_pago' as const,
        environment: 'sandbox' as const,
        providerSubscriptionId: 'subscription-transition-provider-id',
        planId: PLAN,
        providerPlanId: before.providerPlanId!,
        amount: 14990,
        currency: 'CLP',
        updatedAt: before.updatedAt,
      },
    }

    await expect(applySubscriptionTransition(prisma, command)).resolves.toMatchObject({
      applied: true,
      status: 'active',
    })
    await expect(applySubscriptionTransition(prisma, command)).resolves.toMatchObject({
      applied: false,
      status: 'active',
    })

    await expect(prisma.subscriptionPayment.count({
      where: { businessId: BUSINESS },
    })).resolves.toBe(1)
    await expect(prisma.subscriptionLog.count({
      where: { businessId: BUSINESS },
    })).resolves.toBe(1)
  })

  it('dos aprobados idénticos simultáneos convergen en un solo efecto exitoso', async () => {
    const command = {
      ...approvedCommand('payment-simultaneous'),
      expectedProviderSnapshot: {
        provider: 'mercado_pago' as const,
        environment: 'sandbox' as const,
        providerSubscriptionId: 'subscription-transition-provider-id',
        planId: PLAN,
        providerPlanId: 'subscription-transition-provider-plan',
        amount: 14990,
        currency: 'CLP',
      },
    }
    let arrivals = 0
    let releaseBarrier!: () => void
    const barrier = new Promise<void>((resolve) => {
      releaseBarrier = resolve
    })
    const racingPrisma = prisma.$extends({
      query: {
        subscriptionPayment: {
          async createMany({ args, query }) {
            arrivals += 1
            if (arrivals === 2) releaseBarrier()
            await barrier
            return query(args)
          },
        },
      },
    })

    const results = await Promise.allSettled([
      applySubscriptionTransition(
        racingPrisma as unknown as PrismaClient,
        command,
      ),
      applySubscriptionTransition(
        racingPrisma as unknown as PrismaClient,
        command,
      ),
    ])

    expect(results).toEqual([
      expect.objectContaining({ status: 'fulfilled' }),
      expect.objectContaining({ status: 'fulfilled' }),
    ])
    expect(results.flatMap((result) =>
      result.status === 'fulfilled' ? [result.value.applied] : [],
    ).sort()).toEqual([false, true])
    expect(results.flatMap((result) =>
      result.status === 'fulfilled' ? [result.value.status] : [],
    )).toEqual(['active', 'active'])
    await expect(prisma.subscriptionPayment.count({
      where: { businessId: BUSINESS },
    })).resolves.toBe(1)
    await expect(prisma.subscriptionLog.count({
      where: { businessId: BUSINESS },
    })).resolves.toBe(1)
  })

  it('el mismo providerPaymentId concurrente no puede activar dos suscripciones', async () => {
    let arrivals = 0
    let releaseBarrier!: () => void
    const barrier = new Promise<void>((resolve) => {
      releaseBarrier = resolve
    })
    const racingPrisma = prisma.$extends({
      query: {
        subscriptionPayment: {
          async createMany({ args, query }) {
            arrivals += 1
            if (arrivals === 2) releaseBarrier()
            await barrier
            return query(args)
          },
        },
      },
    })

    const sharedPaymentId = 'payment-cross-subscription-race'
    const results = await Promise.allSettled([
      applySubscriptionTransition(
        racingPrisma as unknown as PrismaClient,
        approvedCommand(sharedPaymentId, 'invoice-cross-a'),
      ),
      applySubscriptionTransition(
        racingPrisma as unknown as PrismaClient,
        approvedCommand(
          sharedPaymentId,
          'invoice-cross-b',
          new Date('2026-10-01T00:00:00.000Z'),
          OTHER_SUBSCRIPTION,
        ),
      ),
    ])

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1)

    const [subscriptions, businesses, payments, logs] = await Promise.all([
      prisma.businessSubscription.findMany({
        where: { id: { in: [SUBSCRIPTION, OTHER_SUBSCRIPTION] } },
        orderBy: { id: 'asc' },
      }),
      prisma.business.findMany({
        where: { id: { in: [BUSINESS, OTHER_BUSINESS] } },
      }),
      prisma.subscriptionPayment.findMany({
        where: { providerPaymentId: sharedPaymentId },
      }),
      prisma.subscriptionLog.findMany({
        where: { businessId: { in: [BUSINESS, OTHER_BUSINESS] } },
      }),
    ])

    expect(subscriptions.filter((subscription) => subscription.status === 'active')).toHaveLength(1)
    expect(subscriptions.filter((subscription) => subscription.status === 'past_due')).toHaveLength(1)
    expect(businesses.filter((business) => business.subscriptionStatus === 'active')).toHaveLength(1)
    expect(businesses.filter((business) => business.subscriptionStatus === 'past_due')).toHaveLength(1)
    expect(payments).toHaveLength(1)
    expect(logs).toHaveLength(1)
    expect(payments[0]).toMatchObject({
      subscriptionId: logs[0].businessId === BUSINESS ? SUBSCRIPTION : OTHER_SUBSCRIPTION,
      businessId: logs[0].businessId,
      environment: 'sandbox',
    })
  })

  it('rechaza la fila que otra suscripción reclama después del precheck y antes del CAS', async () => {
    const sharedPaymentId = 'payment-cross-subscription-interleaving'
    let winnerResult: Awaited<ReturnType<typeof applySubscriptionTransition>> | undefined
    let winnerStarted = false
    const staleReaderPrisma = prisma.$extends({
      query: {
        subscriptionPayment: {
          async createMany({ args, query }) {
            if (!winnerStarted) {
              winnerStarted = true
              winnerResult = await applySubscriptionTransition(
                concurrentPrisma,
                approvedCommand(
                  sharedPaymentId,
                  'invoice-cross-winner',
                  new Date('2026-10-01T00:00:00.000Z'),
                  OTHER_SUBSCRIPTION,
                ),
              )
            }
            return query(args)
          },
        },
      },
    })

    await expect(applySubscriptionTransition(
      staleReaderPrisma as unknown as PrismaClient,
      approvedCommand(sharedPaymentId, 'invoice-cross-loser'),
    )).rejects.toThrow(/otra suscripción/)
    expect(winnerResult).toMatchObject({ applied: true, status: 'active' })

    const [subscriptions, payments, logs] = await Promise.all([
      prisma.businessSubscription.findMany({
        where: { id: { in: [SUBSCRIPTION, OTHER_SUBSCRIPTION] } },
      }),
      prisma.subscriptionPayment.findMany({ where: { providerPaymentId: sharedPaymentId } }),
      prisma.subscriptionLog.findMany({
        where: { businessId: { in: [BUSINESS, OTHER_BUSINESS] } },
      }),
    ])

    expect(subscriptions.find((row) => row.id === SUBSCRIPTION)?.status).toBe('past_due')
    expect(subscriptions.find((row) => row.id === OTHER_SUBSCRIPTION)?.status).toBe('active')
    expect(payments).toEqual([
      expect.objectContaining({
        businessId: OTHER_BUSINESS,
        subscriptionId: OTHER_SUBSCRIPTION,
        environment: 'sandbox',
      }),
    ])
    expect(logs).toEqual([
      expect.objectContaining({ businessId: OTHER_BUSINESS }),
    ])
  })

  it('trata un providerInvoiceId ya reclamado por el mismo owner como duplicado', async () => {
    await prisma.subscriptionPayment.create({
      data: {
        businessId: BUSINESS,
        subscriptionId: SUBSCRIPTION,
        amount: 14990,
        currency: 'CLP',
        status: 'approved',
        provider: 'mercado_pago',
        environment: 'sandbox',
        providerPaymentId: 'payment-existing',
        providerInvoiceId: 'invoice-conflict',
        paidAt: new Date('2026-08-01T00:00:00.000Z'),
      },
    })

    await expect(
      applySubscriptionTransition(
        prisma,
        approvedCommand('payment-conflict', 'invoice-conflict'),
      ),
    ).resolves.toEqual({ applied: false, status: 'past_due' })

    const [subscription, business, paymentCount, logCount] = await Promise.all([
      prisma.businessSubscription.findUniqueOrThrow({ where: { id: SUBSCRIPTION } }),
      prisma.business.findUniqueOrThrow({ where: { id: BUSINESS } }),
      prisma.subscriptionPayment.count({ where: { businessId: BUSINESS } }),
      prisma.subscriptionLog.count({ where: { businessId: BUSINESS } }),
    ])

    expect(subscription.status).toBe('past_due')
    expect(subscription.currentPeriodEnd).toEqual(PERIOD_END)
    expect(business.subscriptionStatus).toBe('past_due')
    expect(paymentCount).toBe(1)
    expect(logCount).toBe(0)
  })

  it('prioriza el conflicto de ownership cruzado sobre un snapshot local desactualizado', async () => {
    await prisma.subscriptionPayment.create({
      data: {
        businessId: OTHER_BUSINESS,
        subscriptionId: OTHER_SUBSCRIPTION,
        amount: 14990,
        currency: 'CLP',
        status: 'approved',
        provider: 'mercado_pago',
        environment: 'sandbox',
        providerPaymentId: 'payment-cross-owner-before-snapshot',
        providerInvoiceId: 'invoice-cross-owner-before-snapshot',
        paidAt: PAID_AT,
      },
    })
    await prisma.businessSubscription.update({
      where: { id: SUBSCRIPTION },
      data: { amount: 15990 },
    })

    await expect(applySubscriptionTransition(prisma, {
      ...approvedCommand(
        'payment-cross-owner-before-snapshot',
        'invoice-cross-owner-before-snapshot',
      ),
      expectedProviderSnapshot: {
        provider: 'mercado_pago',
        environment: 'sandbox',
        providerSubscriptionId: 'subscription-transition-provider-id',
        planId: PLAN,
        providerPlanId: 'subscription-transition-provider-plan',
        amount: 14990,
        currency: 'CLP',
      },
    })).rejects.toBeInstanceOf(SubscriptionProviderPaymentOwnershipConflictError)

    await expect(prisma.subscriptionPayment.count()).resolves.toBe(1)
    await expect(prisma.subscriptionLog.count()).resolves.toBe(0)
  })

  it('el CAS aborta sin efectos parciales si otra escritura gana entre lectura y update', async () => {
    const interleavedPrisma = prisma.$extends({
      query: {
        businessSubscription: {
          async updateMany({ args, query }) {
            await concurrentPrisma.businessSubscription.update({
              where: { id: SUBSCRIPTION },
              data: { suspendedReason: 'concurrent-writer' },
            })
            return query(args)
          },
        },
      },
    })

    await expect(
      applySubscriptionTransition(
        interleavedPrisma as unknown as PrismaClient,
        approvedCommand('payment-cas-loser'),
      ),
    ).rejects.toBeInstanceOf(SubscriptionTransitionConflictError)

    const [subscription, business, paymentCount, logCount] = await Promise.all([
      prisma.businessSubscription.findUniqueOrThrow({ where: { id: SUBSCRIPTION } }),
      prisma.business.findUniqueOrThrow({ where: { id: BUSINESS } }),
      prisma.subscriptionPayment.count({ where: { businessId: BUSINESS } }),
      prisma.subscriptionLog.count({ where: { businessId: BUSINESS } }),
    ])

    expect(subscription).toMatchObject({
      status: 'past_due',
      suspendedReason: 'concurrent-writer',
    })
    expect(subscription.currentPeriodEnd).toEqual(PERIOD_END)
    expect(business.subscriptionStatus).toBe('past_due')
    expect(paymentCount).toBe(0)
    expect(logCount).toBe(0)
  })
})
