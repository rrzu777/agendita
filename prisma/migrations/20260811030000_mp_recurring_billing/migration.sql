-- Persistencia forward-only para los dos circuitos de Mercado Pago.
-- La facturación de Agendita usa SubscriptionProvider; los pagos de reservas
-- conservan PaymentProvider y sólo añaden un índice local de preferencias.

BEGIN;

CREATE TYPE "MercadoPagoEnvironment" AS ENUM ('sandbox', 'production');
CREATE TYPE "SubscriptionProvider" AS ENUM ('manual', 'mercado_pago');

CREATE TABLE "SubscriptionPlanMapping" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "provider" "SubscriptionProvider" NOT NULL,
    "environment" "MercadoPagoEnvironment" NOT NULL,
    "providerPlanId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'CLP',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SubscriptionPlanMapping_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "SubscriptionPlanMapping_planId_fkey"
      FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

ALTER TABLE "BusinessSubscription"
  ADD COLUMN "amount" INTEGER,
  ADD COLUMN "currency" TEXT,
  ADD COLUMN "provider" "SubscriptionProvider",
  ADD COLUMN "environment" "MercadoPagoEnvironment",
  ADD COLUMN "providerPlanId" TEXT,
  ADD COLUMN "providerSubscriptionId" TEXT,
  ADD COLUMN "nextBillingAt" TIMESTAMP(3),
  ADD COLUMN "lastPaidAt" TIMESTAMP(3),
  ADD COLUMN "pastDueAt" TIMESTAMP(3),
  ADD COLUMN "graceEndsAt" TIMESTAMP(3),
  ADD COLUMN "graceDays" INTEGER,
  ADD COLUMN "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "cancellationRequestedAt" TIMESTAMP(3),
  ADD COLUMN "complimentaryUntil" TIMESTAMP(3),
  ADD COLUMN "complimentaryReason" TEXT,
  ADD COLUMN "billingEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "lastReconciledAt" TIMESTAMP(3);

-- Los snapshots protegen la facturación histórica frente a cambios futuros del Plan.
-- Las suscripciones existentes permanecen manuales y fuera del rollout de cobro.
UPDATE "BusinessSubscription" AS subscription
SET
  "amount" = plan."priceMonthly",
  "currency" = 'CLP',
  "graceDays" = 7,
  "provider" = 'manual'
FROM "Plan" AS plan
WHERE plan."id" = subscription."planId";

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "BusinessSubscription"
    WHERE "amount" IS NULL
       OR "currency" IS NULL
       OR "graceDays" IS NULL
       OR "provider" IS NULL
  ) THEN
    RAISE EXCEPTION 'BusinessSubscription backfill failed: every existing subscription must reference a Plan';
  END IF;
END
$$;

ALTER TABLE "BusinessSubscription"
  ALTER COLUMN "amount" SET NOT NULL,
  ALTER COLUMN "currency" SET NOT NULL,
  ALTER COLUMN "currency" SET DEFAULT 'CLP',
  ALTER COLUMN "provider" SET NOT NULL,
  ALTER COLUMN "provider" SET DEFAULT 'manual',
  ALTER COLUMN "graceDays" SET NOT NULL,
  ALTER COLUMN "graceDays" SET DEFAULT 7;

ALTER TABLE "SubscriptionPayment"
  ADD COLUMN "provider" "SubscriptionProvider" NOT NULL DEFAULT 'manual',
  ADD COLUMN "environment" "MercadoPagoEnvironment",
  ADD COLUMN "providerPaymentId" TEXT,
  ADD COLUMN "providerInvoiceId" TEXT,
  ADD COLUMN "providerStatus" TEXT,
  ADD COLUMN "providerUpdatedAt" TIMESTAMP(3),
  ADD COLUMN "rawPayload" JSONB;

CREATE TABLE "SubscriptionNotificationDelivery" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "effectiveDate" TIMESTAMP(3) NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "sentAt" TIMESTAMP(3),
    "nextAttemptAt" TIMESTAMP(3),
    "lastErrorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SubscriptionNotificationDelivery_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "SubscriptionNotificationDelivery_dedupeKey_key" UNIQUE ("dedupeKey"),
    CONSTRAINT "SubscriptionNotificationDelivery_businessId_fkey"
      FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SubscriptionNotificationDelivery_subscriptionId_fkey"
      FOREIGN KEY ("subscriptionId") REFERENCES "BusinessSubscription"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

ALTER TABLE "Payment"
  ADD COLUMN "providerPreferenceId" TEXT,
  ADD COLUMN "providerEnvironment" "MercadoPagoEnvironment";

-- Los guards preceden a los índices: una migración nunca elige ni borra una
-- suscripción financiera para hacer caber datos corruptos.
DO $$
BEGIN
  IF EXISTS (
    SELECT "businessId"
    FROM "BusinessSubscription"
    WHERE "status" <> 'cancelled'
    GROUP BY "businessId"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot create BusinessSubscription_one_billable_per_business: duplicate non-cancelled subscriptions exist';
  END IF;
END
$$;

CREATE UNIQUE INDEX "SubscriptionPlanMapping_provider_environment_providerPlanId_key"
  ON "SubscriptionPlanMapping"("provider", "environment", "providerPlanId");
CREATE UNIQUE INDEX "SubscriptionPlanMapping_one_active_per_environment"
  ON "SubscriptionPlanMapping"("planId", "provider", "environment")
  WHERE "isActive" = true;
CREATE INDEX "SubscriptionPlanMapping_planId_provider_environment_idx"
  ON "SubscriptionPlanMapping"("planId", "provider", "environment");

CREATE UNIQUE INDEX "BusinessSubscription_one_billable_per_business"
  ON "BusinessSubscription"("businessId")
  WHERE "status" <> 'cancelled';
CREATE UNIQUE INDEX "BusinessSubscription_provider_env_subscription_key"
  ON "BusinessSubscription"("provider", "environment", "providerSubscriptionId")
  WHERE "providerSubscriptionId" IS NOT NULL;
CREATE UNIQUE INDEX "SubscriptionPayment_provider_environment_payment_key"
  ON "SubscriptionPayment"("provider", "environment", "providerPaymentId")
  WHERE "providerPaymentId" IS NOT NULL;
CREATE UNIQUE INDEX "SubscriptionPayment_provider_environment_invoice_key"
  ON "SubscriptionPayment"("provider", "environment", "providerInvoiceId")
  WHERE "providerInvoiceId" IS NOT NULL;
CREATE INDEX "SubscriptionNotificationDelivery_subscriptionId_idx"
  ON "SubscriptionNotificationDelivery"("subscriptionId");
CREATE INDEX "SubscriptionNotificationDelivery_status_nextAttemptAt_idx"
  ON "SubscriptionNotificationDelivery"("status", "nextAttemptAt");
CREATE UNIQUE INDEX "Payment_provider_environment_preference_key"
  ON "Payment"("provider", "providerEnvironment", "providerPreferenceId")
  WHERE "providerPreferenceId" IS NOT NULL;
CREATE INDEX "Payment_provider_providerEnvironment_providerPreferenceId_idx"
  ON "Payment"("provider", "providerEnvironment", "providerPreferenceId");

COMMIT;
