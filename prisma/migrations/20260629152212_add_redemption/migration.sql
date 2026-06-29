-- CreateEnum
CREATE TYPE "GrantStatus" AS ENUM ('active', 'redeemed', 'expired', 'reversed');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "LoyaltyReason" ADD VALUE 'redemption';
ALTER TYPE "LoyaltyReason" ADD VALUE 'redemption_reversal';

-- AlterTable
ALTER TABLE "LoyaltyConfig" ADD COLUMN     "forfeitGrantOnNoShow" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "grantExpiryDays" INTEGER,
ADD COLUMN     "refundPointsOnExpiry" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "Promotion" ADD COLUMN     "grantExpiryDays" INTEGER,
ADD COLUMN     "pointsCost" INTEGER;

-- CreateTable
CREATE TABLE "PromotionGrant" (
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
CREATE UNIQUE INDEX "PromotionGrant_redeemedBookingId_key" ON "PromotionGrant"("redeemedBookingId");

-- CreateIndex
CREATE INDEX "PromotionGrant_customerId_status_idx" ON "PromotionGrant"("customerId", "status");

-- CreateIndex
CREATE INDEX "PromotionGrant_businessId_promotionId_idx" ON "PromotionGrant"("businessId", "promotionId");

-- CreateIndex
CREATE UNIQUE INDEX "PromotionGrant_businessId_code_key" ON "PromotionGrant"("businessId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "PromotionGrant_customerId_requestId_key" ON "PromotionGrant"("customerId", "requestId");

-- AddForeignKey
ALTER TABLE "PromotionGrant" ADD CONSTRAINT "PromotionGrant_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromotionGrant" ADD CONSTRAINT "PromotionGrant_promotionId_fkey" FOREIGN KEY ("promotionId") REFERENCES "Promotion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromotionGrant" ADD CONSTRAINT "PromotionGrant_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

