-- Make provider plan provisioning recoverable and keep pending checkout
-- candidates separate from authoritative subscription state.

BEGIN;

ALTER TABLE "SubscriptionPlanMapping"
  ADD COLUMN "provisioningLeaseExpiresAt" TIMESTAMP(3),
  ADD COLUMN "externalReference" TEXT;

UPDATE "SubscriptionPlanMapping"
SET
  "externalReference" = 'agendita_plan_' || "id",
  "provisioningLeaseExpiresAt" = CURRENT_TIMESTAMP
WHERE "providerPlanId" IS NULL;

DROP INDEX "SubscriptionPlanMapping_provisioningToken_key";
CREATE UNIQUE INDEX "SubscriptionPlanMapping_provisioningToken_key"
  ON "SubscriptionPlanMapping"("provisioningToken");
CREATE UNIQUE INDEX "SubscriptionPlanMapping_externalReference_key"
  ON "SubscriptionPlanMapping"("externalReference");

ALTER TABLE "SubscriptionPlanMapping"
  DROP CONSTRAINT "SubscriptionPlanMapping_provisioning_state_check",
  ADD CONSTRAINT "SubscriptionPlanMapping_provisioning_state_check"
  CHECK (
    ("providerPlanId" IS NOT NULL AND "provisioningToken" IS NULL AND "provisioningLeaseExpiresAt" IS NULL)
    OR
    ("providerPlanId" IS NULL AND "provisioningToken" IS NOT NULL
      AND "provisioningLeaseExpiresAt" IS NOT NULL AND "externalReference" IS NOT NULL
      AND "isActive" = false)
  );

ALTER TABLE "SubscriptionCheckoutAttempt"
  ADD COLUMN "providerPlanId" TEXT;

-- The previous checkout implementation copied every freshly-created pending
-- candidate onto BusinessSubscription. Move that unverified association back
-- to the attempt so an abandoned checkout cannot freeze trial expiry. An
-- actually authorized candidate remains recoverable from the attempt and will
-- be adopted after an authoritative provider lookup.
UPDATE "SubscriptionCheckoutAttempt" AS attempt
SET "providerPlanId" = subscription."providerPlanId"
FROM "BusinessSubscription" AS subscription
WHERE attempt."subscriptionId" = subscription."id"
  AND attempt."invalidatedAt" IS NULL
  AND attempt."providerSubscriptionId" IS NOT NULL
  AND attempt."providerSubscriptionId" = subscription."providerSubscriptionId";

UPDATE "BusinessSubscription" AS subscription
SET
  "provider" = 'manual',
  "environment" = NULL,
  "providerPlanId" = NULL,
  "providerSubscriptionId" = NULL,
  "nextBillingAt" = NULL
FROM "SubscriptionCheckoutAttempt" AS attempt
WHERE attempt."subscriptionId" = subscription."id"
  AND attempt."invalidatedAt" IS NULL
  AND attempt."providerSubscriptionId" IS NOT NULL
  AND attempt."providerSubscriptionId" = subscription."providerSubscriptionId";

DROP INDEX "SubscriptionCheckoutAttempt_one_open_per_subscription";
CREATE UNIQUE INDEX "SubscriptionCheckoutAttempt_one_open_per_subscription"
  ON "SubscriptionCheckoutAttempt"("subscriptionId", "environment")
  WHERE "invalidatedAt" IS NULL;

COMMIT;
