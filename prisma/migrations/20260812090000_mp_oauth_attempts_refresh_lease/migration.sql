-- Forward-only OAuth attempt replay protection and short refresh leases.

BEGIN;

ALTER TABLE "PaymentAccount"
  ADD COLUMN "refreshLeaseToken" TEXT,
  ADD COLUMN "refreshLeaseExpiresAt" TIMESTAMP(3),
  ADD COLUMN "tokenVersion" INTEGER NOT NULL DEFAULT 0;

-- Connected legacy rows without an attributable Mercado Pago seller cannot be
-- adopted during refresh. Preserve the ciphertext for audit and require an
-- explicit reconnect that proves seller ownership.
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
    OR "providerAccountId" ~ '^[1-9][0-9]*$'
  );

CREATE INDEX "PaymentAccount_refreshLeaseExpiresAt_idx"
  ON "PaymentAccount"("refreshLeaseExpiresAt");

CREATE TABLE "MercadoPagoOAuthAttempt" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "environment" "MercadoPagoEnvironment" NOT NULL,
  "nonceHash" TEXT NOT NULL,
  "verifierEncrypted" TEXT NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "consumedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MercadoPagoOAuthAttempt_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "MercadoPagoOAuthAttempt_businessId_fkey"
    FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "MercadoPagoOAuthAttempt_nonceHash_key"
  ON "MercadoPagoOAuthAttempt"("nonceHash");
CREATE INDEX "MercadoPagoOAuthAttempt_businessId_environment_expiresAt_idx"
  ON "MercadoPagoOAuthAttempt"("businessId", "environment", "expiresAt");

COMMIT;
