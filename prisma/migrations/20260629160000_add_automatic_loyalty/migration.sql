-- CreateEnum
CREATE TYPE "ReferralStatus" AS ENUM ('pending', 'rewarded', 'void');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "LoyaltyReason" ADD VALUE IF NOT EXISTS 'bonus';
ALTER TYPE "LoyaltyReason" ADD VALUE IF NOT EXISTS 'bonus_reversal';

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "firstCompletedAt" TIMESTAMP(3),
ADD COLUMN     "lastCompletedAt" TIMESTAMP(3),
ADD COLUMN     "referralToken" TEXT;

-- AlterTable
ALTER TABLE "LoyaltyConfig" ADD COLUMN     "clawbackAutoRewardOnRefund" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "LoyaltyLedger" ADD COLUMN     "dedupeKey" TEXT,
ADD COLUMN     "sourcePromotionId" TEXT,
ADD COLUMN     "triggeringBookingId" TEXT;

-- AlterTable
ALTER TABLE "Promotion" ADD COLUMN     "priority" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "rewardPoints" INTEGER;

-- AlterTable
ALTER TABLE "PromotionGrant" ADD COLUMN     "triggeringBookingId" TEXT;

-- CreateTable
CREATE TABLE "Referral" (
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
CREATE UNIQUE INDEX "Referral_referredCustomerId_key" ON "Referral"("referredCustomerId");

-- CreateIndex
CREATE INDEX "Referral_businessId_status_idx" ON "Referral"("businessId", "status");

-- CreateIndex
CREATE INDEX "Referral_referrerCustomerId_idx" ON "Referral"("referrerCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_referralToken_key" ON "Customer"("referralToken");

-- CreateIndex
CREATE INDEX "LoyaltyLedger_triggeringBookingId_idx" ON "LoyaltyLedger"("triggeringBookingId");

-- CreateIndex
CREATE INDEX "LoyaltyLedger_businessId_sourcePromotionId_idx" ON "LoyaltyLedger"("businessId", "sourcePromotionId");

-- CreateIndex
CREATE UNIQUE INDEX "LoyaltyLedger_businessId_dedupeKey_key" ON "LoyaltyLedger"("businessId", "dedupeKey");

-- CreateIndex
CREATE INDEX "PromotionGrant_triggeringBookingId_idx" ON "PromotionGrant"("triggeringBookingId");

-- AddForeignKey
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_referrerCustomerId_fkey" FOREIGN KEY ("referrerCustomerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_referredCustomerId_fkey" FOREIGN KEY ("referredCustomerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

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
