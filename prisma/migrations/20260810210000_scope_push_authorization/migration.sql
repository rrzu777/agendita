-- Existing rows predate explicit authorization. Their endpoint SHA-256 is the
-- only non-secret stable fingerprint available without decrypting capabilities.
-- They receive no user authorization or booking entitlement, so delivery fails
-- closed until the browser subscribes again with the full endpoint+keys hash.
ALTER TABLE "PushSubscription"
ADD COLUMN "authorizedUserId" TEXT,
ADD COLUMN "subscriptionFingerprint" TEXT;

UPDATE "PushSubscription"
SET "subscriptionFingerprint" = "endpointHash";

ALTER TABLE "PushSubscription"
ALTER COLUMN "subscriptionFingerprint" SET NOT NULL;

DROP INDEX "PushSubscription_customerId_endpointHash_key";

CREATE UNIQUE INDEX "PushSubscription_customerId_subscriptionFingerprint_key"
ON "PushSubscription"("customerId", "subscriptionFingerprint");

CREATE INDEX "PushSubscription_authorizedUserId_revokedAt_idx"
ON "PushSubscription"("authorizedUserId", "revokedAt");

ALTER TABLE "PushSubscription"
ADD CONSTRAINT "PushSubscription_authorizedUserId_fkey"
FOREIGN KEY ("authorizedUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "PushSubscriptionBooking" (
    "subscriptionId" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PushSubscriptionBooking_pkey" PRIMARY KEY ("subscriptionId", "bookingId")
);

CREATE INDEX "PushSubscriptionBooking_bookingId_subscriptionId_idx"
ON "PushSubscriptionBooking"("bookingId", "subscriptionId");

ALTER TABLE "PushSubscriptionBooking"
ADD CONSTRAINT "PushSubscriptionBooking_subscriptionId_fkey"
FOREIGN KEY ("subscriptionId") REFERENCES "PushSubscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PushSubscriptionBooking"
ADD CONSTRAINT "PushSubscriptionBooking_bookingId_fkey"
FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;
