BEGIN;

ALTER TABLE "SubscriptionNotificationDelivery"
  ADD COLUMN "recipientEmails" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "businessNameSnapshot" TEXT;

UPDATE "SubscriptionNotificationDelivery" AS delivery
SET "businessNameSnapshot" = business."name"
FROM "Business" AS business
WHERE business."id" = delivery."businessId";

ALTER TABLE "SubscriptionNotificationDelivery"
  ALTER COLUMN "businessNameSnapshot" SET NOT NULL;

COMMIT;
