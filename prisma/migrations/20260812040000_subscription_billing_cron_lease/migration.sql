BEGIN;

ALTER TABLE "BusinessSubscription"
  ADD COLUMN "billingCronClaimedUntil" TIMESTAMP(3);

CREATE INDEX "BusinessSubscription_billingCronClaimedUntil_idx"
  ON "BusinessSubscription"("billingCronClaimedUntil");

COMMIT;
