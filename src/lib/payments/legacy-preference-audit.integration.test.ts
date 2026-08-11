import { createRequire } from 'node:module'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db'
import { requireTestDatabase } from '../../../tests/integration/setup'

requireTestDatabase()

const require = createRequire(import.meta.url)
const { auditLegacyPreferences } = require('../../../scripts/audit-legacy-mp-preferences.cjs')
const concurrent = new PrismaClient()
const cutoff = new Date('2026-08-11T00:00:00Z')
const ids = ['legacy-null-environment', 'legacy-null-preference', 'legacy-expired-seller']

async function cleanup() {
  await prisma.paymentProviderIncident.deleteMany({ where: { paymentId: { in: ids } } })
  await prisma.payment.deleteMany({ where: { id: { in: ids } } })
  await prisma.paymentAccount.deleteMany({ where: { businessId: { in: ['legacy-audit-a', 'legacy-audit-b'] } } })
  await prisma.customer.deleteMany({ where: { id: { in: ['legacy-audit-ca', 'legacy-audit-cb'] } } })
  await prisma.business.deleteMany({ where: { id: { in: ['legacy-audit-a', 'legacy-audit-b'] } } })
}

beforeAll(async () => {
  await cleanup()
  await prisma.business.createMany({ data: [
    { id: 'legacy-audit-a', name: 'Legacy A', slug: 'legacy-audit-a', subdomain: 'legacy-audit-a', ownerUserId: 'owner-a', city: 'Santiago' },
    { id: 'legacy-audit-b', name: 'Legacy B', slug: 'legacy-audit-b', subdomain: 'legacy-audit-b', ownerUserId: 'owner-b', city: 'Santiago' },
  ] })
  await prisma.customer.createMany({ data: [
    { id: 'legacy-audit-ca', businessId: 'legacy-audit-a', name: 'A', phone: '+56911111111' },
    { id: 'legacy-audit-cb', businessId: 'legacy-audit-b', name: 'B', phone: '+56922222222' },
  ] })
  await prisma.paymentAccount.create({ data: {
    id: 'legacy-expired-account', businessId: 'legacy-audit-b', provider: 'mercado_pago',
    environment: 'sandbox', status: 'expired', accessTokenEncrypted: 'expired-token',
  } })
  await prisma.payment.createMany({ data: [
    {
      id: ids[0], businessId: 'legacy-audit-a', customerId: 'legacy-audit-ca', provider: 'mercado_pago',
      providerEnvironment: null, providerPreferenceId: null, amount: 1000, currency: 'CLP', status: 'pending',
      paymentType: 'deposit', createdAt: new Date('2026-08-01T00:00:00Z'),
    },
    {
      id: ids[1], businessId: 'legacy-audit-a', customerId: 'legacy-audit-ca', provider: 'mercado_pago',
      providerEnvironment: 'sandbox', providerPreferenceId: null, amount: 2000, currency: 'CLP', status: 'pending',
      paymentType: 'deposit', createdAt: new Date('2026-08-01T00:00:01Z'),
    },
    {
      id: ids[2], businessId: 'legacy-audit-b', customerId: 'legacy-audit-cb', provider: 'mercado_pago',
      providerEnvironment: 'sandbox', providerPreferenceId: 'legacy-pref', amount: 3000, currency: 'CLP', status: 'pending',
      paymentType: 'deposit', createdAt: new Date('2026-08-01T00:00:02Z'),
    },
  ] })
})

afterAll(async () => {
  await cleanup()
  await concurrent.$disconnect()
  await prisma.$disconnect()
})

describe('legacy Mercado Pago preference audit (PostgreSQL)', () => {
  it('dry-run classifies the real legacy population without writes', async () => {
    await expect(auditLegacyPreferences(prisma, { before: cutoff, limit: 50, apply: false }))
      .resolves.toMatchObject({ manual_review: 3 })
    await expect(prisma.paymentProviderIncident.count({ where: { paymentId: { in: ids } } })).resolves.toBe(0)
  })

  it('concurrent apply is idempotent for null environment/preference and an expired seller', async () => {
    const options = { before: cutoff, limit: 50, apply: true }
    await Promise.all([
      auditLegacyPreferences(prisma, options),
      auditLegacyPreferences(concurrent, options),
    ])

    await expect(prisma.paymentProviderIncident.count({
      where: { paymentId: { in: ids }, kind: 'legacy_preference_manual_review', status: 'manual_review' },
    })).resolves.toBe(3)
    const payments = await prisma.payment.findMany({ where: { id: { in: ids } }, select: { status: true } })
    expect(payments).toHaveLength(3)
    expect(payments.every((payment) => payment.status === 'pending')).toBe(true)
  })
})
