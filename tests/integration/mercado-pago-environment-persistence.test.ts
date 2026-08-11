import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '@/lib/db'
import { requireTestDatabase } from './setup'

requireTestDatabase()

const PLAN = 'mp-environment-plan'
const BUSINESS = 'mp-environment-business'
const OTHER_BUSINESS = 'mp-environment-other-business'
const CUSTOMER = 'mp-environment-customer'
const SUBSCRIPTION = 'mp-environment-subscription'
const OTHER_SUBSCRIPTION = 'mp-environment-other-subscription'

async function cleanup() {
  await prisma.subscriptionPayment.deleteMany({
    where: { businessId: { in: [BUSINESS, OTHER_BUSINESS] } },
  })
  await prisma.subscriptionNotificationDelivery.deleteMany({
    where: { businessId: { in: [BUSINESS, OTHER_BUSINESS] } },
  })
  await prisma.payment.deleteMany({ where: { businessId: BUSINESS } })
  await prisma.paymentAccount.deleteMany({
    where: { businessId: { in: [BUSINESS, OTHER_BUSINESS] } },
  })
  await prisma.businessSubscription.deleteMany({
    where: { businessId: { in: [BUSINESS, OTHER_BUSINESS] } },
  })
  await prisma.customer.deleteMany({ where: { businessId: BUSINESS } })
  await prisma.business.deleteMany({ where: { id: { in: [BUSINESS, OTHER_BUSINESS] } } })
  await prisma.plan.deleteMany({ where: { id: PLAN } })
}

async function resetRows() {
  await prisma.subscriptionPayment.deleteMany({
    where: { businessId: { in: [BUSINESS, OTHER_BUSINESS] } },
  })
  await prisma.payment.deleteMany({ where: { businessId: BUSINESS } })
  await prisma.paymentAccount.deleteMany({
    where: { businessId: { in: [BUSINESS, OTHER_BUSINESS] } },
  })
  await prisma.businessSubscription.updateMany({
    where: { businessId: { in: [BUSINESS, OTHER_BUSINESS] } },
    data: {
      provider: 'manual',
      environment: null,
      providerPlanId: null,
      providerSubscriptionId: null,
    },
  })
}

beforeAll(async () => {
  await cleanup()
  await prisma.plan.create({
    data: { id: PLAN, name: PLAN, priceMonthly: 14990, priceYearly: 149900 },
  })
  await prisma.business.createMany({
    data: [
      { id: BUSINESS, name: 'MP Environment', slug: BUSINESS, subdomain: BUSINESS, ownerUserId: 'owner-a', city: 'Santiago' },
      { id: OTHER_BUSINESS, name: 'MP Environment Other', slug: OTHER_BUSINESS, subdomain: OTHER_BUSINESS, ownerUserId: 'owner-b', city: 'Santiago' },
    ],
  })
  await prisma.customer.create({
    data: { id: CUSTOMER, businessId: BUSINESS, name: 'Cliente', phone: '+56911111111' },
  })
  await prisma.businessSubscription.createMany({
    data: [
      {
        id: SUBSCRIPTION,
        businessId: BUSINESS,
        planId: PLAN,
        amount: 14990,
        currentPeriodStart: new Date('2026-08-01T00:00:00.000Z'),
        currentPeriodEnd: new Date('2026-09-01T00:00:00.000Z'),
      },
      {
        id: OTHER_SUBSCRIPTION,
        businessId: OTHER_BUSINESS,
        planId: PLAN,
        amount: 14990,
        currentPeriodStart: new Date('2026-08-01T00:00:00.000Z'),
        currentPeriodEnd: new Date('2026-09-01T00:00:00.000Z'),
      },
    ],
  })
})

beforeEach(resetRows)

afterAll(async () => {
  await cleanup()
  await prisma.$disconnect()
})

describe('Mercado Pago environment persistence', () => {
  it('stores sandbox and production OAuth accounts separately for one business', async () => {
    await prisma.paymentAccount.createMany({
      data: [
        {
          businessId: BUSINESS,
          provider: 'mercado_pago',
          environment: 'sandbox',
          accessTokenEncrypted: 'sandbox-token',
          status: 'connected',
        },
        {
          businessId: BUSINESS,
          provider: 'mercado_pago',
          environment: 'production',
          accessTokenEncrypted: 'production-token',
          status: 'connected',
        },
      ],
    })

    await expect(prisma.paymentAccount.count({
      where: { businessId: BUSINESS, provider: 'mercado_pago' },
    })).resolves.toBe(2)
    await expect(prisma.paymentAccount.create({
      data: {
        businessId: BUSINESS,
        provider: 'mercado_pago',
        environment: 'sandbox',
        accessTokenEncrypted: 'another-sandbox-token',
        status: 'connected',
      },
    })).rejects.toThrow()
    await expect(prisma.paymentAccount.findUnique({
      where: {
        businessId_provider_environment: {
          businessId: BUSINESS,
          provider: 'mercado_pago',
          environment: 'production',
        },
      },
    })).resolves.toMatchObject({ accessTokenEncrypted: 'production-token' })
  })

  it('rejects Mercado Pago external identifiers without an environment', async () => {
    await expect(prisma.businessSubscription.update({
      where: { id: SUBSCRIPTION },
      data: { provider: 'mercado_pago', environment: null, providerSubscriptionId: 'sub-without-environment' },
    })).rejects.toThrow()

    await expect(prisma.subscriptionPayment.create({
      data: {
        businessId: BUSINESS,
        subscriptionId: SUBSCRIPTION,
        amount: 14990,
        provider: 'mercado_pago',
        environment: null,
        providerPaymentId: 'payment-without-environment',
      },
    })).rejects.toThrow()

    await expect(prisma.payment.create({
      data: {
        businessId: BUSINESS,
        customerId: CUSTOMER,
        provider: 'mercado_pago',
        providerPreferenceId: 'preference-without-environment',
        providerEnvironment: null,
        amount: 14990,
        status: 'pending',
        paymentType: 'deposit',
      },
    })).rejects.toThrow()
  })

  it('rejects duplicate external preferences, payments, invoices and subscriptions in one environment', async () => {
    await prisma.payment.create({
      data: {
        businessId: BUSINESS,
        customerId: CUSTOMER,
        provider: 'mercado_pago',
        providerPreferenceId: 'preference-duplicate',
        providerEnvironment: 'sandbox',
        amount: 14990,
        status: 'pending',
        paymentType: 'deposit',
      },
    })
    await expect(prisma.payment.create({
      data: {
        businessId: BUSINESS,
        customerId: CUSTOMER,
        provider: 'mercado_pago',
        providerPreferenceId: 'preference-duplicate',
        providerEnvironment: 'sandbox',
        amount: 14990,
        status: 'pending',
        paymentType: 'deposit',
      },
    })).rejects.toThrow()

    await prisma.subscriptionPayment.create({
      data: {
        businessId: BUSINESS,
        subscriptionId: SUBSCRIPTION,
        amount: 14990,
        provider: 'mercado_pago',
        environment: 'sandbox',
        providerPaymentId: 'payment-duplicate',
        providerInvoiceId: 'invoice-duplicate',
      },
    })
    await expect(prisma.subscriptionPayment.create({
      data: {
        businessId: BUSINESS,
        subscriptionId: SUBSCRIPTION,
        amount: 14990,
        provider: 'mercado_pago',
        environment: 'sandbox',
        providerPaymentId: 'payment-duplicate',
      },
    })).rejects.toThrow()
    await expect(prisma.subscriptionPayment.create({
      data: {
        businessId: BUSINESS,
        subscriptionId: SUBSCRIPTION,
        amount: 14990,
        provider: 'mercado_pago',
        environment: 'sandbox',
        providerInvoiceId: 'invoice-duplicate',
      },
    })).rejects.toThrow()

    await prisma.businessSubscription.update({
      where: { id: SUBSCRIPTION },
      data: { provider: 'mercado_pago', environment: 'sandbox', providerSubscriptionId: 'subscription-duplicate' },
    })
    await expect(prisma.businessSubscription.update({
      where: { id: OTHER_SUBSCRIPTION },
      data: { provider: 'mercado_pago', environment: 'sandbox', providerSubscriptionId: 'subscription-duplicate' },
    })).rejects.toThrow()
  })
})
