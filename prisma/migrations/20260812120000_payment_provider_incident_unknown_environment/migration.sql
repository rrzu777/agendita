ALTER TABLE "PaymentProviderIncident"
  ALTER COLUMN "environment" DROP NOT NULL;

-- PostgreSQL treats NULLs as distinct in a regular unique index. Preserve
-- provider-payment conflict uniqueness for legacy incidents whose historical
-- environment is unknowable with a dedicated partial index.
CREATE UNIQUE INDEX "PaymentProviderIncident_unknownEnv_providerPaymentId_key"
  ON "PaymentProviderIncident"("providerPaymentId")
  WHERE "environment" IS NULL AND "providerPaymentId" IS NOT NULL;
