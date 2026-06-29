-- CreateEnum
CREATE TYPE "LoyaltyReason" AS ENUM ('visit', 'visit_reversal', 'adjustment');

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "loyaltyToken" TEXT;

-- CreateTable
CREATE TABLE "LoyaltyConfig" (
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

-- CreateTable
CREATE TABLE "LoyaltyLedger" (
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

-- CreateIndex
CREATE UNIQUE INDEX "LoyaltyConfig_businessId_key" ON "LoyaltyConfig"("businessId");

-- CreateIndex
CREATE INDEX "LoyaltyLedger_businessId_customerId_idx" ON "LoyaltyLedger"("businessId", "customerId");

-- CreateIndex
CREATE INDEX "LoyaltyLedger_customerId_idx" ON "LoyaltyLedger"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "LoyaltyLedger_bookingId_reason_key" ON "LoyaltyLedger"("bookingId", "reason");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_loyaltyToken_key" ON "Customer"("loyaltyToken");

-- AddForeignKey
ALTER TABLE "LoyaltyConfig" ADD CONSTRAINT "LoyaltyConfig_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoyaltyLedger" ADD CONSTRAINT "LoyaltyLedger_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoyaltyLedger" ADD CONSTRAINT "LoyaltyLedger_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoyaltyLedger" ADD CONSTRAINT "LoyaltyLedger_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE SET NULL ON UPDATE CASCADE;
