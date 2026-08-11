-- A stale lease cannot prove whether Mercado Pago accepted a plan POST. Move
-- ambiguous mappings to an explicit operator-only reconciliation state and
-- retain immutable checkout inputs for safe authorization races.

BEGIN;

CREATE TYPE "SubscriptionPlanProvisioningStatus" AS ENUM (
  'provisioning',
  'ready',
  'manual_reconciliation_required'
);

ALTER TABLE "SubscriptionPlanMapping"
  ADD COLUMN "provisioningStatus" "SubscriptionPlanProvisioningStatus" NOT NULL DEFAULT 'ready';

ALTER TABLE "SubscriptionPlanMapping"
  DROP CONSTRAINT "SubscriptionPlanMapping_provisioning_state_check";

UPDATE "SubscriptionPlanMapping"
SET
  "provisioningStatus" = 'manual_reconciliation_required',
  "provisioningToken" = NULL,
  "provisioningLeaseExpiresAt" = NULL
WHERE "providerPlanId" IS NULL;

ALTER TABLE "SubscriptionPlanMapping"
  ADD CONSTRAINT "SubscriptionPlanMapping_provisioning_state_check"
  CHECK (
    ("provisioningStatus" = 'ready'
      AND "providerPlanId" IS NOT NULL
      AND "provisioningToken" IS NULL
      AND "provisioningLeaseExpiresAt" IS NULL)
    OR
    ("provisioningStatus" = 'provisioning'
      AND "providerPlanId" IS NULL
      AND "provisioningToken" IS NOT NULL
      AND "provisioningLeaseExpiresAt" IS NOT NULL
      AND "externalReference" IS NOT NULL
      AND "isActive" = false)
    OR
    ("provisioningStatus" = 'manual_reconciliation_required'
      AND "providerPlanId" IS NULL
      AND "provisioningToken" IS NULL
      AND "provisioningLeaseExpiresAt" IS NULL
      AND "externalReference" IS NOT NULL
      AND "isActive" = false)
  );

ALTER TABLE "SubscriptionCheckoutAttempt"
  ADD COLUMN "planId" TEXT,
  ADD COLUMN "amount" INTEGER,
  ADD COLUMN "currency" TEXT;

UPDATE "SubscriptionCheckoutAttempt" AS attempt
SET
  "planId" = mapping."planId",
  "amount" = mapping."amount",
  "currency" = mapping."currency"
FROM "SubscriptionPlanMapping" AS mapping
WHERE attempt."providerPlanId" = mapping."providerPlanId"
  AND attempt."environment" = mapping."environment";

COMMIT;
