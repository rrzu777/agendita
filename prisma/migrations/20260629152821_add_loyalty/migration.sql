-- CreateEnum
DO $$
BEGIN
  CREATE TYPE "LoyaltyReason" AS ENUM ('visit', 'visit_reversal', 'adjustment');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "loyaltyToken" TEXT;

-- CreateTable
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

-- CreateTable
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

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "LoyaltyConfig_businessId_key" ON "LoyaltyConfig"("businessId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "LoyaltyLedger_businessId_customerId_idx" ON "LoyaltyLedger"("businessId", "customerId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "LoyaltyLedger_customerId_idx" ON "LoyaltyLedger"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "LoyaltyLedger_bookingId_reason_key" ON "LoyaltyLedger"("bookingId", "reason");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Customer_loyaltyToken_key" ON "Customer"("loyaltyToken");

-- AddForeignKey
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
