import { PrismaClient } from '@prisma/client'
import { afterAll, describe, expect, it } from 'vitest'
import { requireTestDatabase } from './setup'

requireTestDatabase()
const prisma = new PrismaClient()

afterAll(() => prisma.$disconnect())

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
})
