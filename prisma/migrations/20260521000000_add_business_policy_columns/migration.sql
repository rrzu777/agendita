-- Migration: Add cancellationPolicy, bookingPolicy, and depositPolicy to Business.
--
-- IMPORTANT: This migration is idempotent. It can be run multiple times safely.
-- It is designed for:
--   - fresh DBs (e.g. new environments, CI, local dev)
--   - DBs that already have partial changes (e.g. from prisma db push)
--
-- Context:
--   These columns store free-text policies shown on the public business profile.
--   They are nullable because not every business configures them immediately.

-- 1. cancellationPolicy
ALTER TABLE "Business"
ADD COLUMN IF NOT EXISTS "cancellationPolicy" TEXT;

-- 2. bookingPolicy
ALTER TABLE "Business"
ADD COLUMN IF NOT EXISTS "bookingPolicy" TEXT;

-- 3. depositPolicy
ALTER TABLE "Business"
ADD COLUMN IF NOT EXISTS "depositPolicy" TEXT;
