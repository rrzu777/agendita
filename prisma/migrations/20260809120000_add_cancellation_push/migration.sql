ALTER TABLE "Business"
ADD COLUMN "cancellationReminderEnabled" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "Booking"
ADD COLUMN "cancellationCutoffHours" INTEGER,
ADD COLUMN "cancellationPolicySnapshot" TEXT,
ADD COLUMN "cancellationReminderClaimedAt" TIMESTAMP(3),
ADD COLUMN "cancellationReminderSentAt" TIMESTAMP(3);

CREATE TABLE "PushSubscription" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "endpointHash" TEXT NOT NULL,
    "subscriptionEncrypted" TEXT NOT NULL,
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "lastFailureAt" TIMESTAMP(3),
    "lastSuccessAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PushSubscription_customerId_endpointHash_key"
ON "PushSubscription"("customerId", "endpointHash");

CREATE INDEX "PushSubscription_businessId_revokedAt_idx"
ON "PushSubscription"("businessId", "revokedAt");

CREATE INDEX "PushSubscription_endpointHash_revokedAt_idx"
ON "PushSubscription"("endpointHash", "revokedAt");

CREATE INDEX "Booking_status_cancellationReminderSentAt_startDateTime_idx"
ON "Booking"("status", "cancellationReminderSentAt", "startDateTime");

ALTER TABLE "PushSubscription"
ADD CONSTRAINT "PushSubscription_businessId_fkey"
FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PushSubscription"
ADD CONSTRAINT "PushSubscription_customerId_fkey"
FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
