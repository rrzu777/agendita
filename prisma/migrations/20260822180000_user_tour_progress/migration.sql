-- CreateEnum
CREATE TYPE "TourStatus" AS ENUM ('available', 'in_progress', 'completed', 'dismissed');

-- CreateTable
CREATE TABLE "UserTourProgress" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "tourKey" TEXT NOT NULL,
    "tourVersion" INTEGER NOT NULL,
    "status" "TourStatus" NOT NULL,
    "lastStep" INTEGER NOT NULL DEFAULT 0,
    "offeredAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "dismissedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserTourProgress_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserTourProgress_userId_businessId_tourKey_tourVersion_key"
ON "UserTourProgress"("userId", "businessId", "tourKey", "tourVersion");

-- CreateIndex
CREATE INDEX "UserTourProgress_businessId_status_updatedAt_idx"
ON "UserTourProgress"("businessId", "status", "updatedAt");

-- AddForeignKey
ALTER TABLE "UserTourProgress"
ADD CONSTRAINT "UserTourProgress_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserTourProgress"
ADD CONSTRAINT "UserTourProgress_businessId_fkey"
FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
