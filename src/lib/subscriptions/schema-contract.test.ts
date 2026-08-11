import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const schemaPath = path.join(root, 'prisma/schema.prisma')
const migrationPath = path.join(
  root,
  'prisma/migrations/20260811030000_mp_recurring_billing/migration.sql',
)

describe('Mercado Pago recurring billing persistence contract', () => {
  it('declares the provider-separated recurring billing schema', async () => {
    const schema = await readFile(schemaPath, 'utf8')

    expect(schema).toContain('enum MercadoPagoEnvironment')
    expect(schema).toContain('sandbox')
    expect(schema).toContain('production')
    expect(schema).toContain('enum SubscriptionProvider')
    expect(schema).toContain('manual')
    expect(schema).toContain('mercado_pago')
    expect(schema).toContain('model SubscriptionPlanMapping')
    expect(schema).toContain('complimentaryUntil')
    expect(schema).toContain('cancelAtPeriodEnd')
    expect(schema).toContain('providerPaymentId')
    expect(schema).toContain('@@unique([provider, environment, providerPaymentId])')
    expect(schema).toContain('model SubscriptionNotificationDelivery')
    expect(schema).toContain('providerPreferenceId')
    expect(schema).toMatch(/providerEnvironment\s+MercadoPagoEnvironment\?/)
  })

  it('enforces nullable provider identifiers with partial unique indexes', async () => {
    const migration = await readFile(migrationPath, 'utf8')

    expect(migration).toContain('BEGIN;')
    expect(migration).toContain('COMMIT;')
    expect(migration).toContain('"BusinessSubscription_one_billable_per_business"')
    expect(migration).toContain('WHERE "status" <> \'cancelled\'')
    expect(migration).toContain('"SubscriptionPayment_provider_environment_payment_key"')
    expect(migration).toContain('WHERE "providerPaymentId" IS NOT NULL')
    expect(migration).toContain('"SubscriptionPayment_provider_environment_invoice_key"')
    expect(migration).toContain('WHERE "providerInvoiceId" IS NOT NULL')
    expect(migration).toContain('"Payment_provider_environment_preference_key"')
    expect(migration).toContain('WHERE "providerPreferenceId" IS NOT NULL')
    expect(migration).toContain('"SubscriptionPlanMapping_one_active_per_environment"')
    expect(migration).toContain('WHERE "isActive" = true')
  })
})
