-- Persist trial entitlement independently from dated complimentary access and
-- dedupe the non-enforcing grace-expiry audit.

BEGIN;

ALTER TABLE "BusinessSubscription"
  ADD COLUMN "trialDays" INTEGER NOT NULL DEFAULT 30,
  ADD COLUMN "graceEnforcementDeferredAt" TIMESTAMP(3);

-- Preserve configured historical trial length when both endpoints exist.
UPDATE "BusinessSubscription"
SET "trialDays" = LEAST(
  365,
  GREATEST(
    0,
    CEIL(EXTRACT(EPOCH FROM ("trialEndAt" - "trialStartAt")) / 86400.0)::INTEGER
  )
)
WHERE "trialStartAt" IS NOT NULL
  AND "trialEndAt" IS NOT NULL;

ALTER TABLE "BusinessSubscription"
  ADD CONSTRAINT "BusinessSubscription_trial_days_check"
  CHECK ("trialDays" BETWEEN 0 AND 365);

COMMIT;
