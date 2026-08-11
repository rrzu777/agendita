BEGIN;
ALTER TABLE "SubscriptionNotificationDelivery"
  ADD COLUMN "eventAt" TIMESTAMP(3),
  ADD COLUMN "availableAt" TIMESTAMP(3),
  ADD COLUMN "eventId" TEXT,
  ADD COLUMN "firstProviderAttemptAt" TIMESTAMP(3),
  ADD COLUMN "manualReviewAt" TIMESTAMP(3);
UPDATE "SubscriptionNotificationDelivery"
SET "eventAt" = "createdAt", "availableAt" = COALESCE("nextAttemptAt", "createdAt");
ALTER TABLE "SubscriptionNotificationDelivery"
  ALTER COLUMN "eventAt" SET NOT NULL,
  ALTER COLUMN "availableAt" SET NOT NULL;
CREATE INDEX "SubscriptionNotificationDelivery_status_availableAt_idx"
  ON "SubscriptionNotificationDelivery"("status", "availableAt");
COMMIT;
