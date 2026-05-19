-- Migration: Add unique constraints to prevent duplicate Payments and LedgerEntries.
--
-- IMPORTANT: This migration is idempotent. It can be run multiple times safely.
--
-- OPERATIONAL NOTE:
--   If your database already contains duplicate Payments (same bookingId + provider +
--   providerPaymentId) or duplicate LedgerEntries for the same paymentId, this
--   migration WILL FAIL with a unique-violation error.
--   BEFORE running this migration in staging or production, inspect and clean any
--   duplicates manually. This script does NOT perform destructive cleanup automatically.
--   Example queries to detect duplicates:
--     SELECT "bookingId", "provider", "providerPaymentId", COUNT(*) FROM "Payment"
--       GROUP BY "bookingId", "provider", "providerPaymentId"
--       HAVING COUNT(*) > 1;
--     SELECT "paymentId", COUNT(*) FROM "LedgerEntry"
--       WHERE "paymentId" IS NOT NULL
--       GROUP BY "paymentId"
--       HAVING COUNT(*) > 1;
--
-- Context:
--   - Payment: we want to prevent creating the exact same payment twice for the
--     same booking. For online payments, providerPaymentId is non-null; for manual
--     payments it is null. PostgreSQL treats NULLs as unequal in unique indexes,
--     so multiple manual payments for the same booking are still allowed.
--   - LedgerEntry: we want exactly one LedgerEntry per Payment. The unique
--     constraint on paymentId guarantees this. Multiple LedgerEntries without
--     a paymentId (e.g., manual adjustments) are still allowed because NULLs are
--     not considered equal in PostgreSQL unique indexes.

-- 1. Payment unique constraint: (bookingId, provider, providerPaymentId)
CREATE UNIQUE INDEX IF NOT EXISTS "Payment_bookingId_provider_providerPaymentId_key"
ON "Payment" ("bookingId", "provider", "providerPaymentId");

-- 2. LedgerEntry unique constraint: paymentId
CREATE UNIQUE INDEX IF NOT EXISTS "LedgerEntry_paymentId_key"
ON "LedgerEntry" ("paymentId");

-- Rollback (for reference only; do NOT uncomment in production):
-- DROP INDEX IF EXISTS "LedgerEntry_paymentId_key";
-- DROP INDEX IF EXISTS "Payment_bookingId_provider_providerPaymentId_key";
