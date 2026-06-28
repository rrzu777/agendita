-- CreateEnum
CREATE TYPE "PromotionTrigger" AS ENUM ('code', 'automatic', 'granted');
CREATE TYPE "PromotionReward" AS ENUM ('percentage', 'fixed_amount', 'free_service');
CREATE TYPE "RedemptionStatus" AS ENUM ('applied', 'released');
CREATE TYPE "RedemptionSource" AS ENUM ('public_booking', 'dashboard_booking', 'system');
CREATE TYPE "RedemptionRelease" AS ENUM ('cancelled', 'no_show', 'hold_expired', 'refunded');

-- CreateTable Promotion
CREATE TABLE "Promotion" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "triggerType" "PromotionTrigger" NOT NULL DEFAULT 'code',
  "code" TEXT,
  "conditions" JSONB,
  "rewardType" "PromotionReward" NOT NULL,
  "rewardValue" INTEGER NOT NULL,
  "maxDiscount" INTEGER,
  "appliesToAll" BOOLEAN NOT NULL DEFAULT true,
  "validFrom" TIMESTAMP(3),
  "validUntil" TIMESTAMP(3),
  "minSpend" INTEGER,
  "maxRedemptions" INTEGER,
  "maxPerCustomer" INTEGER,
  "redemptionCount" INTEGER NOT NULL DEFAULT 0,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "metadata" JSONB,
  "createdByUserId" TEXT,
  "updatedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Promotion_pkey" PRIMARY KEY ("id")
);

-- CreateTable PromotionRedemption
CREATE TABLE "PromotionRedemption" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "promotionId" TEXT NOT NULL,
  "bookingId" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "discountAmount" INTEGER NOT NULL,
  "status" "RedemptionStatus" NOT NULL DEFAULT 'applied',
  "releaseReason" "RedemptionRelease",
  "releasedAt" TIMESTAMP(3),
  "source" "RedemptionSource" NOT NULL,
  "createdByUserId" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PromotionRedemption_pkey" PRIMARY KEY ("id")
);

-- CreateTable join _PromotionServices
CREATE TABLE "_PromotionServices" (
  "A" TEXT NOT NULL,
  "B" TEXT NOT NULL
);

-- Indexes
CREATE UNIQUE INDEX "Promotion_businessId_code_key" ON "Promotion"("businessId", "code");
CREATE INDEX "Promotion_businessId_isActive_idx" ON "Promotion"("businessId", "isActive");
CREATE UNIQUE INDEX "PromotionRedemption_bookingId_key" ON "PromotionRedemption"("bookingId");
CREATE INDEX "PromotionRedemption_businessId_promotionId_idx" ON "PromotionRedemption"("businessId", "promotionId");
CREATE INDEX "PromotionRedemption_promotionId_customerId_idx" ON "PromotionRedemption"("promotionId", "customerId");
CREATE UNIQUE INDEX "_PromotionServices_AB_unique" ON "_PromotionServices"("A", "B");
CREATE INDEX "_PromotionServices_B_index" ON "_PromotionServices"("B");

-- FKs
ALTER TABLE "Promotion" ADD CONSTRAINT "Promotion_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PromotionRedemption" ADD CONSTRAINT "PromotionRedemption_promotionId_fkey" FOREIGN KEY ("promotionId") REFERENCES "Promotion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PromotionRedemption" ADD CONSTRAINT "PromotionRedemption_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PromotionRedemption" ADD CONSTRAINT "PromotionRedemption_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "_PromotionServices" ADD CONSTRAINT "_PromotionServices_A_fkey" FOREIGN KEY ("A") REFERENCES "Promotion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "_PromotionServices" ADD CONSTRAINT "_PromotionServices_B_fkey" FOREIGN KEY ("B") REFERENCES "Service"("id") ON DELETE CASCADE ON UPDATE CASCADE;
