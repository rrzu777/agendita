BEGIN;

UPDATE "SubscriptionNotificationDelivery"
SET "firstProviderAttemptAt" = COALESCE("updatedAt", "createdAt")
WHERE "attempts" > 0
  AND "firstProviderAttemptAt" IS NULL;

UPDATE "SubscriptionNotificationDelivery"
SET
  "status" = 'manual_review',
  "manualReviewAt" = CURRENT_TIMESTAMP,
  "nextAttemptAt" = NULL,
  "lastErrorCode" = 'legacy_attempt_outside_idempotency_window'
WHERE "status" IN ('pending', 'failed')
  AND "attempts" > 0
  AND "firstProviderAttemptAt" < CURRENT_TIMESTAMP - INTERVAL '23 hours';

COMMIT;
