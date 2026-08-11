BEGIN;

-- El backfill anterior usaba updatedAt, que puede reflejar un retry y no el
-- primer request al proveedor. En filas existentes preferimos una cota segura:
-- createdAt no puede ser posterior al primer intento real.
UPDATE "SubscriptionNotificationDelivery"
SET "firstProviderAttemptAt" = LEAST(
  COALESCE("firstProviderAttemptAt", "createdAt"),
  "createdAt"
)
WHERE "attempts" > 0;

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
