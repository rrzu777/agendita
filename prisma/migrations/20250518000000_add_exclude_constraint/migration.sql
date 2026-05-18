-- Migration: Add bookingWindowDays, holdExpiresAt, idempotencyKey, expired enum,
--   indexes, unique constraint, and EXCLUDE constraint for anti-overlap.
--
-- IMPORTANT: This migration is idempotent. It can be run multiple times
-- safely against a DB that already has some or all of these changes.
-- It is designed for:
--   - fresh DBs (e.g. new environments, CI, local dev)
--   - DBs that already have partial changes (e.g. from prisma db push)
--
-- NOTE: Booking.startDateTime and endDateTime are `timestamp without time zone`
-- (Prisma DateTime default), so we use `tsrange` instead of `tstzrange`.

-- 1. Extension
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- 2. Business.bookingWindowDays
ALTER TABLE "Business"
ADD COLUMN IF NOT EXISTS "bookingWindowDays" INTEGER NOT NULL DEFAULT 90;

-- 3. Booking.holdExpiresAt
ALTER TABLE "Booking"
ADD COLUMN IF NOT EXISTS "holdExpiresAt" TIMESTAMP(3) WITHOUT TIME ZONE;

-- 4. Booking.idempotencyKey
ALTER TABLE "Booking"
ADD COLUMN IF NOT EXISTS "idempotencyKey" TEXT;

-- 5. BookingStatus enum value: expired
--    Postgres does not support IF NOT EXISTS for enum values.
--    We check pg_enum before adding.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumtypid = (SELECT oid FROM pg_type WHERE typname = 'BookingStatus')
      AND enumlabel = 'expired'
  ) THEN
    ALTER TYPE "BookingStatus" ADD VALUE 'expired';
  END IF;
END;
$$;

-- 6. TimeBlock index
CREATE INDEX IF NOT EXISTS "TimeBlock_businessId_startDateTime_endDateTime_idx"
ON "TimeBlock" ("businessId", "startDateTime", "endDateTime");

-- 7. Booking index (status filter)
CREATE INDEX IF NOT EXISTS "Booking_businessId_status_startDateTime_endDateTime_idx"
ON "Booking" ("businessId", "status", "startDateTime", "endDateTime");

-- 8. Booking unique constraint: (businessId, idempotencyKey)
--    Prisma maps @@unique([businessId, idempotencyKey]) to a unique index.
--    We create it as a unique index so it can be idempotent.
CREATE UNIQUE INDEX IF NOT EXISTS "Booking_businessId_idempotencyKey_key"
ON "Booking" ("businessId", "idempotencyKey");

-- 9. Booking EXCLUDE constraint (partial, for overlapping bookings)
--    Only active for statuses: pending_payment, confirmed, completed.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'Booking_no_overlap'
      AND conrelid = '"Booking"'::regclass
  ) THEN
    ALTER TABLE "Booking"
    ADD CONSTRAINT "Booking_no_overlap"
    EXCLUDE USING gist (
      "businessId" WITH =,
      tsrange("startDateTime", "endDateTime", '[)') WITH &&
    )
    WHERE (
      status IN ('pending_payment', 'confirmed', 'completed')
    );
  END IF;
END;
$$;

-- Rollback (for reference only; do NOT uncomment in production):
-- ALTER TABLE "Booking" DROP CONSTRAINT IF EXISTS "Booking_no_overlap";
-- DROP INDEX IF EXISTS "Booking_businessId_idempotencyKey_key";
-- DROP INDEX IF EXISTS "Booking_businessId_status_startDateTime_endDateTime_idx";
-- DROP INDEX IF EXISTS "TimeBlock_businessId_startDateTime_endDateTime_idx";
-- ALTER TABLE "Booking" DROP COLUMN IF EXISTS "idempotencyKey";
-- ALTER TABLE "Booking" DROP COLUMN IF EXISTS "holdExpiresAt";
-- ALTER TABLE "Business" DROP COLUMN IF EXISTS "bookingWindowDays";
