import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db'
import { requireTestDatabase } from '../../../tests/integration/setup'
import { claimApprovedProviderPayment } from './provider-incidents'

requireTestDatabase()

const BUSINESS_ID = 'provider-incident-business'
const CUSTOMER_ID = 'provider-incident-customer'
const PAYMENT_ID = 'provider-incident-payment'
const concurrent = new PrismaClient()

async function cleanup() {
  await prisma.paymentProviderIncident.deleteMany({ where: { paymentId: PAYMENT_ID } })
  await prisma.payment.deleteMany({ where: { id: PAYMENT_ID } })
  await prisma.customer.deleteMany({ where: { id: CUSTOMER_ID } })
  await prisma.business.deleteMany({ where: { id: BUSINESS_ID } })
}

beforeAll(async () => {
  await cleanup()
  await prisma.business.create({
    data: {
      id: BUSINESS_ID, name: 'Provider Incident', slug: BUSINESS_ID,
      subdomain: BUSINESS_ID, ownerUserId: 'provider-incident-owner', city: 'Santiago',
    },
  })
  await prisma.customer.create({
    data: { id: CUSTOMER_ID, businessId: BUSINESS_ID, name: 'Customer', phone: '+56911111111' },
  })
})

beforeEach(async () => {
  await prisma.paymentProviderIncident.deleteMany({ where: { paymentId: PAYMENT_ID } })
  await prisma.payment.deleteMany({ where: { id: PAYMENT_ID } })
  await prisma.payment.create({
    data: {
      id: PAYMENT_ID, businessId: BUSINESS_ID, customerId: CUSTOMER_ID,
      provider: 'mercado_pago', providerEnvironment: 'sandbox', amount: 10000,
      currency: 'CLP', status: 'pending', paymentType: 'deposit',
    },
  })
})

afterAll(async () => {
  await cleanup()
  await concurrent.$disconnect()
  await prisma.$disconnect()
})

describe('approved provider payment claim (PostgreSQL)', () => {
  it('migration exposes the durable incident table and manual-review index', async () => {
    const rows = await prisma.$queryRaw<Array<{ indexname: string }>>`
      SELECT indexname FROM pg_indexes
      WHERE schemaname = current_schema()
        AND tablename = 'PaymentProviderIncident'
    `
    expect(rows.map((row) => row.indexname)).toEqual(expect.arrayContaining([
      'PaymentProviderIncident_dedupeKey_key',
      'PaymentProviderIncident_paymentId_status_createdAt_idx',
    ]))
  })

  it('serializes distinct concurrent approvals and retains the loser for manual review', async () => {
    const claim = (client: PrismaClient, providerPaymentId: string) => client.$transaction((tx) =>
      claimApprovedProviderPayment(tx, {
        paymentId: PAYMENT_ID,
        environment: 'sandbox',
        providerPaymentId,
        payload: { id: providerPaymentId, status: 'approved', transactionAmount: 10000, currencyId: 'CLP' },
      }),
    )
    const results = await Promise.all([
      claim(prisma, 'provider-concurrent-a'),
      claim(concurrent, 'provider-concurrent-b'),
    ])

    expect(results.filter((result) => result.kind === 'claimed')).toHaveLength(1)
    expect(results.filter((result) => result.kind === 'conflict')).toHaveLength(1)
    const stored = await prisma.payment.findUniqueOrThrow({ where: { id: PAYMENT_ID } })
    const incidents = await prisma.paymentProviderIncident.findMany({ where: { paymentId: PAYMENT_ID } })
    expect(['provider-concurrent-a', 'provider-concurrent-b']).toContain(stored.providerPaymentId)
    expect(incidents).toHaveLength(1)
    expect(incidents[0]).toMatchObject({
      kind: 'distinct_approved_overpayment', status: 'manual_review',
    })
    expect(JSON.stringify(incidents[0].payload)).not.toMatch(/payer|email|token|card/i)
  })

  it('can retain more than one distinct extra real approval', async () => {
    await prisma.$transaction((tx) => claimApprovedProviderPayment(tx, {
      paymentId: PAYMENT_ID, environment: 'sandbox', providerPaymentId: 'provider-winner',
      payload: { id: 'provider-winner', status: 'approved' },
    }))
    for (const providerPaymentId of ['provider-extra-a', 'provider-extra-b']) {
      await prisma.$transaction((tx) => claimApprovedProviderPayment(tx, {
        paymentId: PAYMENT_ID, environment: 'sandbox', providerPaymentId,
        payload: { id: providerPaymentId, status: 'approved' },
      }))
    }
    await expect(prisma.paymentProviderIncident.count({
      where: { paymentId: PAYMENT_ID, status: 'manual_review' },
    })).resolves.toBe(2)
  })
})
