-- PostgreSQL CHECK treats NULL as unknown, so the original regex-only check
-- did not reject connected Mercado Pago accounts without an attributable seller.
ALTER TABLE "PaymentAccount"
  DROP CONSTRAINT "PaymentAccount_connected_mp_seller_check";

-- Rows may have been written after the previous migration because its CHECK
-- admitted NULL. Quarantine them before installing the corrected invariant.
UPDATE "PaymentAccount"
SET "status" = 'expired'
WHERE "provider" = 'mercado_pago'
  AND "status" = 'connected'
  AND ("providerAccountId" IS NULL OR "providerAccountId" !~ '^[1-9][0-9]*$');

ALTER TABLE "PaymentAccount"
  ADD CONSTRAINT "PaymentAccount_connected_mp_seller_check"
  CHECK (
    "provider" <> 'mercado_pago'
    OR "status" <> 'connected'
    OR (
      "providerAccountId" IS NOT NULL
      AND "providerAccountId" ~ '^[1-9][0-9]*$'
    )
  );
