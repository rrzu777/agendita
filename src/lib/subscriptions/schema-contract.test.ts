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
const correctiveMigrationPath = path.join(
  root,
  'prisma/migrations/20260811120000_mp_payment_account_environment/migration.sql',
)
const stateMachineMigrationPath = path.join(
  root,
  'prisma/migrations/20260811180000_subscription_state_machine_hardening/migration.sql',
)
const checkoutHardeningMigrationPath = path.join(
  root,
  'prisma/migrations/20260812020000_subscription_checkout_hardening/migration.sql',
)
const manualReconciliationMigrationPath = path.join(
  root,
  'prisma/migrations/20260812030000_subscription_plan_manual_reconciliation/migration.sql',
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
    expect(schema).toMatch(/model PaymentAccount[\s\S]*?environment\s+MercadoPagoEnvironment\?/)
    expect(schema).toContain('@@unique([businessId, provider, environment])')
    expect(schema).toContain('model SubscriptionPlanMapping')
    expect(schema).toContain('complimentaryUntil')
    expect(schema).toContain('cancelAtPeriodEnd')
    expect(schema).toMatch(/trialDays\s+Int\s+@default\(30\)/)
    expect(schema).toContain('graceEnforcementDeferredAt')
    expect(schema).toContain('providerPaymentId')
    expect(schema).toContain(
      '@@unique([provider, environment, providerPaymentId], map: "SubscriptionPayment_provider_environment_payment_key")',
    )
    expect(schema).toContain('model SubscriptionNotificationDelivery')
    expect(schema).toContain('providerPreferenceId')
    expect(schema).toMatch(/providerEnvironment\s+MercadoPagoEnvironment\?/)
  })

  it('persists deferred trial entitlement and enforcement-off dedupe forward-only', async () => {
    const migration = await readFile(stateMachineMigrationPath, 'utf8')

    expect(migration).toContain('BEGIN;')
    expect(migration).toContain('ADD COLUMN "trialDays" INTEGER NOT NULL DEFAULT 30')
    expect(migration).toContain('ADD COLUMN "graceEnforcementDeferredAt" TIMESTAMP(3)')
    expect(migration).toContain('BusinessSubscription_trial_days_check')
    expect(migration).toContain('COMMIT;')
  })

  it('enforces nullable provider identifiers with partial unique indexes', async () => {
    const migration = await readFile(migrationPath, 'utf8')
    const correctiveMigration = await readFile(correctiveMigrationPath, 'utf8')

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
    expect(correctiveMigration).toContain('"BusinessSubscription_mercado_pago_environment_check"')
    expect(correctiveMigration).toContain('"SubscriptionPayment_mercado_pago_environment_check"')
    expect(correctiveMigration).toContain('"Payment_mercado_pago_preference_environment_check"')
    expect(correctiveMigration).toContain('"PaymentAccount_mercado_pago_environment_check"')
    expect(correctiveMigration).toContain("'mercado_pago_legacy'")
    expect(correctiveMigration).toContain('DROP INDEX IF EXISTS "PaymentAccount_businessId_provider_key"')
  })

  it('aligns checkout coordination indexes and persists recoverable provisioning leases', async () => {
    const schema = await readFile(schemaPath, 'utf8')
    const migration = await readFile(checkoutHardeningMigrationPath, 'utf8')

    expect(schema).toContain('@unique(map: "SubscriptionPlanMapping_provisioningToken_key")')
    expect(schema).toContain('@unique(map: "SubscriptionPlanMapping_externalReference_key")')
    expect(schema).toContain('map: "SubscriptionPlanMapping_price_version_key"')
    expect(schema).toContain('PostgreSQL owns these partial nullable-ID indexes')
    expect(schema).toContain('provisioningLeaseExpiresAt')
    expect(migration).toContain('DROP INDEX "SubscriptionPlanMapping_provisioningToken_key"')
    expect(migration).toContain('CREATE UNIQUE INDEX "SubscriptionPlanMapping_provisioningToken_key"')
    expect(migration).not.toContain('WHERE "provisioningToken" IS NOT NULL')
    expect(migration).toContain('SubscriptionCheckoutAttempt_one_open_per_subscription')
    expect(migration).toContain('WHERE "invalidatedAt" IS NULL')
    expect(migration).toContain('attempt."providerSubscriptionId" = subscription."providerSubscriptionId"')
    expect(migration).toContain('"providerSubscriptionId" = NULL')
  })

  it('persists fail-closed manual plan reconciliation and immutable checkout snapshots', async () => {
    const schema = await readFile(schemaPath, 'utf8')
    const migration = await readFile(manualReconciliationMigrationPath, 'utf8')

    expect(schema).toContain('manual_reconciliation_required')
    expect(schema).toContain('provisioningStatus')
    expect(schema).toMatch(/model SubscriptionCheckoutAttempt[\s\S]*?planId\s+String\?/)
    expect(schema).toMatch(/model SubscriptionCheckoutAttempt[\s\S]*?amount\s+Int\?/)
    expect(migration).toContain("'manual_reconciliation_required'")
    expect(migration).toContain('ADD COLUMN "planId" TEXT')
    expect(migration).toContain('ADD COLUMN "amount" INTEGER')
    expect(migration).toContain('SubscriptionPlanMapping_provisioning_state_check')
  })
})
