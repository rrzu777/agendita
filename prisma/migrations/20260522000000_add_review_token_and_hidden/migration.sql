-- Migration: Add reviewToken + reviewTokenCreatedAt to Booking, and isHidden to Review.
--
-- IMPORTANT: This migration is idempotent. It can be run multiple times safely.
--
-- Context:
--   reviewToken enables public review links that don't require auth.
--   reviewToken is only generated for completed bookings.
--   isHidden allows reviews to be hidden from the public profile
--   without being deleted, separating pending from hidden states.

-- 1. reviewToken on Booking (nullable, unique)
ALTER TABLE "Booking"
ADD COLUMN IF NOT EXISTS "reviewToken" TEXT;

ALTER TABLE "Booking"
ADD COLUMN IF NOT EXISTS "reviewTokenCreatedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX IF NOT EXISTS "Booking_reviewToken_key"
ON "Booking" ("reviewToken");

-- 2. isHidden on Review (default false)
ALTER TABLE "Review"
ADD COLUMN IF NOT EXISTS "isHidden" BOOLEAN NOT NULL DEFAULT false;
