import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db'
import { requireTestDatabase } from '../../../tests/integration/setup'
import {
  applySubscriptionTransition,
  SubscriptionTransitionConflictError,
} from './transition'

requireTestDatabase()

const PLAN = 'subscription-transition-plan'
const BUSINESS = 'subscription-transition-business'
const SUBSCRIPTION = 'subscription-transition-subscription'
const PERIOD_END = new Date('2026-09-01T00:00:00.000Z')
const PAID_AT = new Date('2026-08-15T12:00:00.000Z')
const concurrentPrisma = new PrismaClient()

async function cleanup() {
  await prisma.subscriptionPayment.deleteMany({ where: { businessId: BUSINESS } })
  await prisma.subscriptionLog.deleteMany({ where: { businessId: BUSINESS } })
  await prisma.businessSubscription.deleteMany({ where: { businessId: BUSINESS } })
  await prisma.business.deleteMany({ where: { id: BUSINESS } })
  await prisma.plan.deleteMany({ where: { id: PLAN } })
}

async function resetSubscription() {
  await prisma.subscriptionPayment.deleteMany({ where: { businessId: BUSINESS } })
  await prisma.subscriptionLog.deleteMany({ where: { businessId: BUSINESS } })
  await prisma.business.update({
    where: { id: BUSINESS },
    data: { subscriptionStatus: 'past_due' },
  })
  await prisma.businessSubscription.update({
    where: { id: SUBSCRIPTION },
    data: {
      status: 'past_due',
      currentPeriodStart: new Date('2026-08-01T00:00:00.000Z'),
      currentPeriodEnd: PERIOD_END,
      lastPaidAt: null,
      nextBillingAt: null,
      pastDueAt: new Date('2026-08-10T00:00:00.000Z'),
      graceEndsAt: new Date('2026-08-17T00:00:00.000Z'),
      suspendedAt: null,
      suspendedReason: null,
    },
  })
}

beforeAll(async () => {
  await cleanup()
  await prisma.plan.create({
    data: { id: PLAN, name: PLAN, priceMonthly: 14990, priceYearly: 149900 },
  })
  await prisma.business.create({
    data: {
      id: BUSINESS,
      name: 'Subscription Transition',
      slug: BUSINESS,
      subdomain: BUSINESS,
      ownerUserId: 'subscription-transition-owner',
      city: 'Santiago',
      subscriptionStatus: 'past_due',
      planId: PLAN,
    },
  })
  await prisma.businessSubscription.create({
    data: {
      id: SUBSCRIPTION,
      businessId: BUSINESS,
      planId: PLAN,
      status: 'past_due',
      amount: 14990,
      currency: 'CLP',
      provider: 'mercado_pago',
      environment: 'sandbox',
      providerSubscriptionId: 'subscription-transition-provider-id',
      currentPeriodStart: new Date('2026-08-01T00:00:00.000Z'),
      currentPeriodEnd: PERIOD_END,
      pastDueAt: new Date('2026-08-10T00:00:00.000Z'),
      graceEndsAt: new Date('2026-08-17T00:00:00.000Z'),
      billingEnabled: true,
    },
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
) {
  return {
    subscriptionId: SUBSCRIPTION,
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

describe('applySubscriptionTransition', () => {
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

  it('dos aprobados idénticos simultáneos convergen en un solo efecto exitoso', async () => {
    let arrivals = 0
    let releaseBarrier!: () => void
    const barrier = new Promise<void>((resolve) => {
      releaseBarrier = resolve
    })
    const racingPrisma = prisma.$extends({
      query: {
        businessSubscription: {
          async updateMany({ args, query }) {
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
        approvedCommand('payment-simultaneous'),
      ),
      applySubscriptionTransition(
        racingPrisma as unknown as PrismaClient,
        approvedCommand('payment-simultaneous'),
      ),
    ])

    expect(results).toEqual([
      expect.objectContaining({ status: 'fulfilled' }),
      expect.objectContaining({ status: 'fulfilled' }),
    ])
    expect(results.flatMap((result) =>
      result.status === 'fulfilled' ? [result.value.applied] : [],
    ).sort()).toEqual([false, true])
    await expect(prisma.subscriptionPayment.count({
      where: { businessId: BUSINESS },
    })).resolves.toBe(1)
    await expect(prisma.subscriptionLog.count({
      where: { businessId: BUSINESS },
    })).resolves.toBe(1)
  })

  it('revierte estado, compatibilidad y log si el pago viola unicidad', async () => {
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
    ).rejects.toThrow()

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
