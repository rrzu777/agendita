-- CreateEnum
DO $$
BEGIN
  CREATE TYPE "ReferralStatus" AS ENUM ('pending', 'rewarded', 'void');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "LoyaltyReason" ADD VALUE IF NOT EXISTS 'bonus';
ALTER TYPE "LoyaltyReason" ADD VALUE IF NOT EXISTS 'bonus_reversal';

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "firstCompletedAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "lastCompletedAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "referralToken" TEXT;

-- AlterTable
ALTER TABLE "LoyaltyConfig" ADD COLUMN IF NOT EXISTS "clawbackAutoRewardOnRefund" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "LoyaltyLedger" ADD COLUMN IF NOT EXISTS "dedupeKey" TEXT,
ADD COLUMN IF NOT EXISTS "sourcePromotionId" TEXT,
ADD COLUMN IF NOT EXISTS "triggeringBookingId" TEXT;

-- AlterTable
ALTER TABLE "Promotion" ADD COLUMN IF NOT EXISTS "priority" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "rewardPoints" INTEGER;

-- AlterTable
ALTER TABLE "PromotionGrant" ADD COLUMN IF NOT EXISTS "triggeringBookingId" TEXT;

-- CreateTable
CREATE TABLE IF NOT EXISTS "Referral" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "referrerCustomerId" TEXT NOT NULL,
    "referredCustomerId" TEXT NOT NULL,
    "status" "ReferralStatus" NOT NULL DEFAULT 'pending',
    "triggeringBookingId" TEXT,
    "rewardedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Referral_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Referral_referredCustomerId_key" ON "Referral"("referredCustomerId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Referral_businessId_status_idx" ON "Referral"("businessId", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Referral_referrerCustomerId_idx" ON "Referral"("referrerCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Customer_referralToken_key" ON "Customer"("referralToken");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "LoyaltyLedger_triggeringBookingId_idx" ON "LoyaltyLedger"("triggeringBookingId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "LoyaltyLedger_businessId_sourcePromotionId_idx" ON "LoyaltyLedger"("businessId", "sourcePromotionId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "LoyaltyLedger_businessId_dedupeKey_key" ON "LoyaltyLedger"("businessId", "dedupeKey");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PromotionGrant_triggeringBookingId_idx" ON "PromotionGrant"("triggeringBookingId");

-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Referral_businessId_fkey') THEN
    ALTER TABLE "Referral" ADD CONSTRAINT "Referral_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Referral_referrerCustomerId_fkey') THEN
    ALTER TABLE "Referral" ADD CONSTRAINT "Referral_referrerCustomerId_fkey" FOREIGN KEY ("referrerCustomerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Referral_referredCustomerId_fkey') THEN
    ALTER TABLE "Referral" ADD CONSTRAINT "Referral_referredCustomerId_fkey" FOREIGN KEY ("referredCustomerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- Backfill firstCompletedAt / lastCompletedAt desde reservas completadas existentes.
UPDATE "Customer" c SET
  "firstCompletedAt" = sub.min_dt,
  "lastCompletedAt"  = sub.max_dt
FROM (
  SELECT "customerId", MIN("updatedAt") AS min_dt, MAX("updatedAt") AS max_dt
  FROM "Booking" WHERE "status" = 'completed' AND "customerId" IS NOT NULL
  GROUP BY "customerId"
) sub
WHERE c."id" = sub."customerId";
