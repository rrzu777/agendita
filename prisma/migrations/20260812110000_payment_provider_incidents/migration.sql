CREATE TABLE "PaymentProviderIncident" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "environment" "MercadoPagoEnvironment" NOT NULL,
    "providerPaymentId" TEXT,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'manual_review',
    "payload" JSONB NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PaymentProviderIncident_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PaymentProviderIncident_environment_providerPaymentId_key"
  ON "PaymentProviderIncident"("environment", "providerPaymentId")
  WHERE "providerPaymentId" IS NOT NULL;
CREATE UNIQUE INDEX "PaymentProviderIncident_dedupeKey_key"
  ON "PaymentProviderIncident"("dedupeKey");
CREATE INDEX "PaymentProviderIncident_paymentId_status_createdAt_idx"
  ON "PaymentProviderIncident"("paymentId", "status", "createdAt");
ALTER TABLE "PaymentProviderIncident" ADD CONSTRAINT "PaymentProviderIncident_paymentId_fkey"
  FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
