import { PrismaClient } from '@prisma/client'
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { requireTestDatabase } from './setup'

requireTestDatabase()
const prisma = new PrismaClient()
const planId = 'financial-index-plan'
const businessId = 'financial-index-business'
const subscriptionId = 'financial-index-subscription'
const customerId = 'financial-index-customer'
const paymentId = 'financial-index-payment'

beforeAll(async () => {
  await prisma.paymentProviderIncident.deleteMany({ where: { paymentId } })
  await prisma.payment.deleteMany({ where: { id: paymentId } })
  await prisma.subscriptionPayment.deleteMany({ where: { businessId } })
  await prisma.businessSubscription.deleteMany({ where: { businessId } })
  await prisma.customer.deleteMany({ where: { id: customerId } })
  await prisma.business.deleteMany({ where: { id: businessId } })
  await prisma.plan.deleteMany({ where: { id: planId } })
  await prisma.plan.create({ data: { id: planId, name: planId, priceMonthly: 1000, priceYearly: 12000 } })
  await prisma.business.create({
    data: { id: businessId, name: businessId, slug: businessId, subdomain: businessId, ownerUserId: 'index-owner', city: 'Santiago' },
  })
  await prisma.customer.create({ data: { id: customerId, businessId, name: 'Index customer', phone: '+56911111111' } })
  await prisma.businessSubscription.create({
    data: {
      id: subscriptionId,
      businessId,
      planId,
      amount: 1000,
      currentPeriodStart: new Date('2026-08-01T00:00:00Z'),
      currentPeriodEnd: new Date('2026-09-01T00:00:00Z'),
    },
  })
  await prisma.payment.create({
    data: { id: paymentId, businessId, customerId, amount: 1000, provider: 'manual', status: 'pending', paymentType: 'deposit' },
  })
})

afterAll(async () => {
  await prisma.paymentProviderIncident.deleteMany({ where: { paymentId } })
  await prisma.payment.deleteMany({ where: { id: paymentId } })
  await prisma.subscriptionPayment.deleteMany({ where: { businessId } })
  await prisma.businessSubscription.deleteMany({ where: { businessId } })
  await prisma.customer.deleteMany({ where: { id: customerId } })
  await prisma.business.deleteMany({ where: { id: businessId } })
  await prisma.plan.deleteMany({ where: { id: planId } })
  await prisma.$disconnect()
})

describe('financial unique index schema parity', () => {
  it('uses full unique indexes matching Prisma while preserving nullable IDs', async () => {
    const names = [
      'BusinessSubscription_provider_env_subscription_key',
      'SubscriptionPayment_provider_environment_payment_key',
      'SubscriptionPayment_provider_environment_invoice_key',
      'PaymentProviderIncident_environment_providerPaymentId_key',
    ]
    const indexes = await prisma.$queryRaw<Array<{ indexname: string; indexdef: string }>>`
      SELECT indexname, indexdef
      FROM pg_indexes
      WHERE schemaname = current_schema() AND indexname = ANY(${names})
    `
    expect(indexes).toHaveLength(names.length)
    for (const index of indexes) {
      expect(index.indexdef).toContain('UNIQUE INDEX')
      expect(index.indexdef).not.toContain(' WHERE ')
    }
  })

  it('keeps the drop-and-recreate migration atomic', () => {
    const sql = readFileSync(
      'prisma/migrations/20260812130000_align_financial_unique_indexes/migration.sql',
      'utf8',
    ).trim()
    expect(sql).toMatch(/^BEGIN;/)
    expect(sql).toMatch(/COMMIT;$/)
  })

  it('allows repeated nullable provider IDs but rejects repeated concrete IDs', async () => {
    const base = { businessId, subscriptionId, amount: 1000, provider: 'manual' as const }
    await prisma.subscriptionPayment.createMany({
      data: [{ ...base }, { ...base }, { ...base, providerInvoiceId: null }, { ...base, providerPaymentId: null }],
    })
    await prisma.subscriptionPayment.create({
      data: { ...base, provider: 'mercado_pago', environment: 'sandbox', providerPaymentId: 'payment-unique' },
    })
    await expect(prisma.subscriptionPayment.create({
      data: { ...base, provider: 'mercado_pago', environment: 'sandbox', providerPaymentId: 'payment-unique' },
    })).rejects.toThrow()
  })

  it('preserves the unknown-environment incident guard while allowing fully nullable incidents', async () => {
    await prisma.paymentProviderIncident.createMany({
      data: [
        { paymentId, dedupeKey: 'nullable-incident-1', kind: 'conflict', payload: {} },
        { paymentId, dedupeKey: 'nullable-incident-2', kind: 'conflict', payload: {} },
        { paymentId, dedupeKey: 'nullable-sandbox-incident-1', environment: 'sandbox', kind: 'conflict', payload: {} },
        { paymentId, dedupeKey: 'nullable-sandbox-incident-2', environment: 'sandbox', kind: 'conflict', payload: {} },
      ],
    })
    await prisma.paymentProviderIncident.create({
      data: { paymentId, dedupeKey: 'unknown-env-1', providerPaymentId: 'unknown-payment', kind: 'conflict', payload: {} },
    })
    await expect(prisma.paymentProviderIncident.create({
      data: { paymentId, dedupeKey: 'unknown-env-2', providerPaymentId: 'unknown-payment', kind: 'conflict', payload: {} },
    })).rejects.toThrow()
  })
})
