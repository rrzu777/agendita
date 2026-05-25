-- Migration: Add subscription model, onboarding fields, and reminder timestamp.
-- This is INCREMENTAL — it only adds new things, never recreates existing tables/enums.
-- All statements use IF NOT EXISTS / IF EXISTS for idempotent re-runs.
--
-- Context:
--   Subscription model enables per-business plans (Beta gratis, Básico, Pro).
--   Onboarding fields track setup progress for new businesses.
--   reminderSentAt deduplicates reminder emails from the cron job.

-- ── 1. New enums ──────────────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE "SubscriptionStatus" AS ENUM ('trialing', 'active', 'past_due', 'suspended', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "BillingInterval" AS ENUM ('monthly', 'yearly');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── 2. New tables ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "Plan" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "priceMonthly" INTEGER NOT NULL,
    "priceYearly" INTEGER NOT NULL,
    "isPublic" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Plan_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Plan_name_key" ON "Plan"("name");

CREATE TABLE IF NOT EXISTS "BusinessSubscription" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'trialing',
    "interval" "BillingInterval" NOT NULL DEFAULT 'monthly',
    "currentPeriodStart" TIMESTAMP(3) NOT NULL,
    "currentPeriodEnd" TIMESTAMP(3) NOT NULL,
    "trialStartAt" TIMESTAMP(3),
    "trialEndAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "suspendedAt" TIMESTAMP(3),
    "suspendedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BusinessSubscription_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "BusinessSubscription_businessId_idx"
ON "BusinessSubscription"("businessId");

CREATE TABLE IF NOT EXISTS "SubscriptionPayment" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'CLP',
    "status" "PaymentStatus" NOT NULL DEFAULT 'pending',
    "paymentMethod" TEXT,
    "notes" TEXT,
    "createdByUserId" TEXT,
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SubscriptionPayment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "SubscriptionPayment_businessId_idx"
ON "SubscriptionPayment"("businessId");

CREATE TABLE IF NOT EXISTS "SubscriptionLog" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "beforeStatus" TEXT,
    "afterStatus" TEXT,
    "beforePlanId" TEXT,
    "afterPlanId" TEXT,
    "adminUserId" TEXT,
    "adminEmail" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubscriptionLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "SubscriptionLog_businessId_createdAt_idx"
ON "SubscriptionLog"("businessId", "createdAt");

-- ── 3. New columns on Business ─────────────────────────────────────────────────

ALTER TABLE "Business"
ADD COLUMN IF NOT EXISTS "planId" TEXT;

ALTER TABLE "Business"
ADD COLUMN IF NOT EXISTS "subscriptionStatus" "SubscriptionStatus" NOT NULL DEFAULT 'trialing';

ALTER TABLE "Business"
ADD COLUMN IF NOT EXISTS "trialEndsAt" TIMESTAMP(3);

ALTER TABLE "Business"
ADD COLUMN IF NOT EXISTS "onboardingCompletedAt" TIMESTAMP(3);

ALTER TABLE "Business"
ADD COLUMN IF NOT EXISTS "onboardingStep" INTEGER;

-- ── 4. New column on Booking ───────────────────────────────────────────────────

ALTER TABLE "Booking"
ADD COLUMN IF NOT EXISTS "reminderSentAt" TIMESTAMP(3);

-- ── 5. Foreign keys ────────────────────────────────────────────────────────────

DO $$ BEGIN
  ALTER TABLE "Business" ADD CONSTRAINT "Business_planId_fkey"
  FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "BusinessSubscription" ADD CONSTRAINT "BusinessSubscription_businessId_fkey"
  FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "BusinessSubscription" ADD CONSTRAINT "BusinessSubscription_planId_fkey"
  FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "SubscriptionPayment" ADD CONSTRAINT "SubscriptionPayment_businessId_fkey"
  FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "SubscriptionPayment" ADD CONSTRAINT "SubscriptionPayment_subscriptionId_fkey"
  FOREIGN KEY ("subscriptionId") REFERENCES "BusinessSubscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "SubscriptionLog" ADD CONSTRAINT "SubscriptionLog_businessId_fkey"
  FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── 6. Backfill: ensure every existing business has a plan + subscription ──────

-- Create Beta gratis plan if not exists
INSERT INTO "Plan" ("id", "name", "description", "priceMonthly", "priceYearly", "isPublic", "sortOrder", "createdAt", "updatedAt")
SELECT
  'plan_beta_free',
  'Beta gratis',
  'Plan gratuito para negocios durante la beta. Acceso completo a todas las funcionalidades.',
  0,
  0,
  false,
  1,
  NOW(),
  NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Plan" WHERE "id" = 'plan_beta_free');

-- Assign planId to businesses that don't have one
UPDATE "Business"
SET "planId" = 'plan_beta_free'
WHERE "planId" IS NULL;

-- Create initial subscription for businesses that don't have one
INSERT INTO "BusinessSubscription" (
  "id", "businessId", "planId", "status", "interval",
  "currentPeriodStart", "currentPeriodEnd",
  "trialStartAt", "trialEndAt",
  "createdAt", "updatedAt"
)
SELECT
  'sub_' || b."id",
  b."id",
  COALESCE(b."planId", 'plan_beta_free'),
  'trialing',
  'monthly',
  NOW(),
  NOW() + INTERVAL '90 days',
  NOW(),
  NOW() + INTERVAL '90 days',
  NOW(),
  NOW()
FROM "Business" b
LEFT JOIN "BusinessSubscription" s ON s."businessId" = b."id"
WHERE s."id" IS NULL;

-- Ensure trialEndsAt is set for businesses still in trial that lack it
UPDATE "Business"
SET "trialEndsAt" = NOW() + INTERVAL '90 days'
WHERE "subscriptionStatus" = 'trialing' AND "trialEndsAt" IS NULL;
