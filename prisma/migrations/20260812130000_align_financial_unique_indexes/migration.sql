BEGIN;

-- Prisma declares these full compound unique indexes. PostgreSQL unique
-- indexes already allow multiple rows containing NULL, so removing the WHERE
-- clauses preserves the intended nullable-ID behavior while eliminating schema
-- drift for deploy/diagnostic tooling.

DROP INDEX "BusinessSubscription_provider_env_subscription_key";
CREATE UNIQUE INDEX "BusinessSubscription_provider_env_subscription_key"
  ON "BusinessSubscription"("provider", "environment", "providerSubscriptionId");

DROP INDEX "SubscriptionPayment_provider_environment_payment_key";
CREATE UNIQUE INDEX "SubscriptionPayment_provider_environment_payment_key"
  ON "SubscriptionPayment"("provider", "environment", "providerPaymentId");

DROP INDEX "SubscriptionPayment_provider_environment_invoice_key";
CREATE UNIQUE INDEX "SubscriptionPayment_provider_environment_invoice_key"
  ON "SubscriptionPayment"("provider", "environment", "providerInvoiceId");

DROP INDEX "PaymentProviderIncident_environment_providerPaymentId_key";
CREATE UNIQUE INDEX "PaymentProviderIncident_environment_providerPaymentId_key"
  ON "PaymentProviderIncident"("environment", "providerPaymentId");

COMMIT;
