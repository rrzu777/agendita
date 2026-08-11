-- Forward-only corrective migration for sandbox/production OAuth isolation.

BEGIN;

ALTER TABLE "PaymentAccount"
  ADD COLUMN "environment" "MercadoPagoEnvironment";

-- A pre-environment OAuth token cannot be safely classified as sandbox or
-- production. Preserve it for audit, but never select it for checkout/webhooks;
-- the business must explicitly reconnect in the target environment.
UPDATE "PaymentAccount"
SET
  "provider" = 'mercado_pago_legacy',
  "status" = 'expired'
WHERE "provider" = 'mercado_pago'
  AND "environment" IS NULL;

ALTER TABLE "PaymentAccount"
  DROP CONSTRAINT IF EXISTS "PaymentAccount_businessId_provider_key";

DROP INDEX IF EXISTS "PaymentAccount_businessId_provider_key";

ALTER TABLE "PaymentAccount"
  ADD CONSTRAINT "PaymentAccount_businessId_provider_environment_key"
  UNIQUE ("businessId", "provider", "environment"),
  ADD CONSTRAINT "PaymentAccount_mercado_pago_environment_check"
  CHECK ("provider" <> 'mercado_pago' OR "environment" IS NOT NULL);

ALTER TABLE "BusinessSubscription"
  ADD CONSTRAINT "BusinessSubscription_mercado_pago_environment_check"
  CHECK (
    ("provider" = 'mercado_pago' AND "environment" IS NOT NULL)
    OR (
      "provider" = 'manual'
      AND "environment" IS NULL
      AND "providerPlanId" IS NULL
      AND "providerSubscriptionId" IS NULL
    )
  );

ALTER TABLE "SubscriptionPayment"
  ADD CONSTRAINT "SubscriptionPayment_mercado_pago_environment_check"
  CHECK (
    ("provider" = 'mercado_pago' AND "environment" IS NOT NULL)
    OR (
      "provider" = 'manual'
      AND "environment" IS NULL
      AND "providerPaymentId" IS NULL
      AND "providerInvoiceId" IS NULL
    )
  );

ALTER TABLE "Payment"
  ADD CONSTRAINT "Payment_mercado_pago_preference_environment_check"
  CHECK (
    ("provider" = 'mercado_pago' AND ("providerPreferenceId" IS NULL OR "providerEnvironment" IS NOT NULL))
    OR (
      "provider" <> 'mercado_pago'
      AND "providerPreferenceId" IS NULL
      AND "providerEnvironment" IS NULL
    )
  );

COMMIT;
