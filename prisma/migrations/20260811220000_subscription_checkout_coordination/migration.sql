-- Coordinate external plan provisioning and hosted checkout callbacks without
-- keeping provider URLs or bearer references in the database.

BEGIN;

ALTER TABLE "SubscriptionPlanMapping"
  ALTER COLUMN "providerPlanId" DROP NOT NULL,
  ADD COLUMN "provisioningToken" TEXT;

CREATE UNIQUE INDEX "SubscriptionPlanMapping_provisioningToken_key"
  ON "SubscriptionPlanMapping"("provisioningToken")
  WHERE "provisioningToken" IS NOT NULL;

CREATE UNIQUE INDEX "SubscriptionPlanMapping_price_version_key"
  ON "SubscriptionPlanMapping"("planId", "provider", "environment", "amount", "currency");

ALTER TABLE "SubscriptionPlanMapping"
  ADD CONSTRAINT "SubscriptionPlanMapping_provisioning_state_check"
  CHECK (
    ("providerPlanId" IS NOT NULL AND "provisioningToken" IS NULL)
    OR
    ("providerPlanId" IS NULL AND "provisioningToken" IS NOT NULL AND "isActive" = false)
  );

CREATE TABLE "SubscriptionCheckoutAttempt" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "subscriptionId" TEXT NOT NULL,
  "environment" "MercadoPagoEnvironment" NOT NULL,
  "referenceHash" TEXT NOT NULL,
  "providerSubscriptionId" TEXT,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "consumedAt" TIMESTAMP(3),
  "invalidatedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "SubscriptionCheckoutAttempt_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SubscriptionCheckoutAttempt_businessId_fkey"
    FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "SubscriptionCheckoutAttempt_subscriptionId_fkey"
    FOREIGN KEY ("subscriptionId") REFERENCES "BusinessSubscription"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "SubscriptionCheckoutAttempt_referenceHash_key"
  ON "SubscriptionCheckoutAttempt"("referenceHash");
CREATE UNIQUE INDEX "SubscriptionCheckoutAttempt_one_open_per_subscription"
  ON "SubscriptionCheckoutAttempt"("subscriptionId", "environment")
  WHERE "consumedAt" IS NULL AND "invalidatedAt" IS NULL;
CREATE INDEX "SubscriptionCheckoutAttempt_subscriptionId_environment_idx"
  ON "SubscriptionCheckoutAttempt"("subscriptionId", "environment");
CREATE INDEX "SubscriptionCheckoutAttempt_expiresAt_idx"
  ON "SubscriptionCheckoutAttempt"("expiresAt");

COMMIT;
