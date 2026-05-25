-- Migration: Add PaymentAccount for Mercado Pago multi-tenant
-- INCREMENTAL only — adds new enum and table. No table recreates.

DO $$ BEGIN
  CREATE TYPE "PaymentAccountStatus" AS ENUM ('pending', 'connected', 'expired', 'disconnected', 'error');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "PaymentAccount" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT,
    "accessTokenEncrypted" TEXT NOT NULL,
    "refreshTokenEncrypted" TEXT,
    "publicKeyEncrypted" TEXT,
    "expiresAt" TIMESTAMP(3),
    "status" "PaymentAccountStatus" NOT NULL DEFAULT 'pending',
    "connectedAt" TIMESTAMP(3),
    "disconnectedAt" TIMESTAMP(3),
    "lastRefreshAt" TIMESTAMP(3),
    "rawMetadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentAccount_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "PaymentAccount_businessId_provider_key"
ON "PaymentAccount"("businessId", "provider");

DO $$ BEGIN
  ALTER TABLE "PaymentAccount" ADD CONSTRAINT "PaymentAccount_businessId_fkey"
  FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
