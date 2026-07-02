-- CreateTable
CREATE TABLE "TimeBlockSeries" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "daysOfWeek" INTEGER[],
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "reason" TEXT,
    "anchorDate" TIMESTAMP(3) NOT NULL,
    "until" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TimeBlockSeries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimeBlockException" (
    "id" TEXT NOT NULL,
    "seriesId" TEXT NOT NULL,
    "occurrenceDate" TIMESTAMP(3) NOT NULL,
    "isSkipped" BOOLEAN NOT NULL DEFAULT false,
    "startDateTime" TIMESTAMP(3),
    "endDateTime" TIMESTAMP(3),
    "reason" TEXT,

    CONSTRAINT "TimeBlockException_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TimeBlockSeries_businessId_isActive_idx" ON "TimeBlockSeries"("businessId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "TimeBlockException_seriesId_occurrenceDate_key" ON "TimeBlockException"("seriesId", "occurrenceDate");

-- AddForeignKey
ALTER TABLE "TimeBlockSeries" ADD CONSTRAINT "TimeBlockSeries_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeBlockException" ADD CONSTRAINT "TimeBlockException_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "TimeBlockSeries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

