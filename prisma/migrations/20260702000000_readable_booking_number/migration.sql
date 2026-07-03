-- AlterTable
ALTER TABLE "Business" ADD COLUMN     "bookingNumberSeq" INTEGER NOT NULL DEFAULT 1000;

-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "bookingNumber" INTEGER;

-- Backfill: randomize every business's base (covers zero-booking businesses too)
UPDATE "Business" SET "bookingNumberSeq" = 1000 + floor(random() * 9000)::int;

-- Backfill: assign jittered, monotonic, per-business-unique numbers to existing bookings.
-- Per-row range [base + (rn-1)*7, base + (rn-1)*7 + 5]; next row starts at +7 so ranges never overlap.
WITH seq AS (
  SELECT b.id,
         b."businessId",
         row_number() OVER (PARTITION BY b."businessId" ORDER BY b."createdAt", b.id) AS rn
  FROM "Booking" b
)
UPDATE "Booking" bk
SET "bookingNumber" = biz."bookingNumberSeq" + (seq.rn - 1) * 7 + floor(random() * 6)::int
FROM seq
JOIN "Business" biz ON biz.id = seq."businessId"
WHERE bk.id = seq.id;

-- Raise each business's seq to its max assigned number so future bookings continue above the range
UPDATE "Business" biz
SET "bookingNumberSeq" = m.maxnum
FROM (SELECT "businessId", max("bookingNumber") AS maxnum FROM "Booking" GROUP BY "businessId") m
WHERE biz.id = m."businessId";

-- CreateIndex (after backfill so no NULL/duplicate blocks it)
CREATE UNIQUE INDEX "Booking_businessId_bookingNumber_key" ON "Booking"("businessId", "bookingNumber");
