-- CreateEnum
DO $$
BEGIN
  CREATE TYPE "GrantStatus" AS ENUM ('active', 'redeemed', 'expired', 'reversed');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Create loyalty primitives early because this migration extends them before
-- 20260629152821_add_loyalty runs in timestamp order.
DO $$
BEGIN
  CREATE TYPE "LoyaltyReason" AS ENUM ('visit', 'visit_reversal', 'adjustment');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "loyaltyToken" TEXT;

CREATE TABLE IF NOT EXISTS "LoyaltyConfig" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "programName" TEXT NOT NULL,
    "pointsLabel" TEXT NOT NULL DEFAULT 'puntos',
    "pointsPerVisit" INTEGER NOT NULL DEFAULT 0,
    "spendPerPoint" INTEGER,
    "minSpendToEarn" INTEGER,
    "cardMessage" TEXT,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LoyaltyConfig_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "LoyaltyLedger" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "points" INTEGER NOT NULL,
    "reason" "LoyaltyReason" NOT NULL,
    "bookingId" TEXT,
    "note" TEXT,
    "metadata" JSONB,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoyaltyLedger_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "LoyaltyConfig_businessId_key" ON "LoyaltyConfig"("businessId");
CREATE INDEX IF NOT EXISTS "LoyaltyLedger_businessId_customerId_idx" ON "LoyaltyLedger"("businessId", "customerId");
CREATE INDEX IF NOT EXISTS "LoyaltyLedger_customerId_idx" ON "LoyaltyLedger"("customerId");
CREATE UNIQUE INDEX IF NOT EXISTS "LoyaltyLedger_bookingId_reason_key" ON "LoyaltyLedger"("bookingId", "reason");
CREATE UNIQUE INDEX IF NOT EXISTS "Customer_loyaltyToken_key" ON "Customer"("loyaltyToken");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LoyaltyConfig_businessId_fkey') THEN
    ALTER TABLE "LoyaltyConfig" ADD CONSTRAINT "LoyaltyConfig_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LoyaltyLedger_businessId_fkey') THEN
    ALTER TABLE "LoyaltyLedger" ADD CONSTRAINT "LoyaltyLedger_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LoyaltyLedger_customerId_fkey') THEN
    ALTER TABLE "LoyaltyLedger" ADD CONSTRAINT "LoyaltyLedger_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LoyaltyLedger_bookingId_fkey') THEN
    ALTER TABLE "LoyaltyLedger" ADD CONSTRAINT "LoyaltyLedger_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "LoyaltyReason" ADD VALUE IF NOT EXISTS 'redemption';
ALTER TYPE "LoyaltyReason" ADD VALUE IF NOT EXISTS 'redemption_reversal';

-- AlterTable
ALTER TABLE "LoyaltyConfig" ADD COLUMN IF NOT EXISTS "forfeitGrantOnNoShow" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "grantExpiryDays" INTEGER,
ADD COLUMN IF NOT EXISTS "refundPointsOnExpiry" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "Promotion" ADD COLUMN IF NOT EXISTS "grantExpiryDays" INTEGER,
ADD COLUMN IF NOT EXISTS "pointsCost" INTEGER;

-- CreateTable
CREATE TABLE IF NOT EXISTS "PromotionGrant" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "promotionId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "pointsSpent" INTEGER NOT NULL,
    "status" "GrantStatus" NOT NULL DEFAULT 'active',
    "expiresAt" TIMESTAMP(3),
    "refundOnExpiry" BOOLEAN NOT NULL,
    "forfeitOnNoShow" BOOLEAN NOT NULL,
    "requestId" TEXT NOT NULL,
    "redeemedBookingId" TEXT,
    "redeemedAt" TIMESTAMP(3),
    "reversedAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PromotionGrant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "PromotionGrant_redeemedBookingId_key" ON "PromotionGrant"("redeemedBookingId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PromotionGrant_customerId_status_idx" ON "PromotionGrant"("customerId", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PromotionGrant_businessId_promotionId_idx" ON "PromotionGrant"("businessId", "promotionId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "PromotionGrant_businessId_code_key" ON "PromotionGrant"("businessId", "code");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "PromotionGrant_customerId_requestId_key" ON "PromotionGrant"("customerId", "requestId");

-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PromotionGrant_businessId_fkey') THEN
    ALTER TABLE "PromotionGrant" ADD CONSTRAINT "PromotionGrant_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PromotionGrant_promotionId_fkey') THEN
    ALTER TABLE "PromotionGrant" ADD CONSTRAINT "PromotionGrant_promotionId_fkey" FOREIGN KEY ("promotionId") REFERENCES "Promotion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PromotionGrant_customerId_fkey') THEN
    ALTER TABLE "PromotionGrant" ADD CONSTRAINT "PromotionGrant_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
