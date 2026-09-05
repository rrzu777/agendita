-- Durable weekly owner insights. All feature flags remain disabled by default.
BEGIN;

CREATE TYPE "AnalyticsInsightStatus" AS ENUM ('insufficient_data', 'deterministic_ready', 'generating', 'ready', 'generation_failed', 'expired');
CREATE TYPE "AnalyticsInsightGenerationStatus" AS ENUM ('not_requested', 'pending', 'running', 'succeeded', 'failed', 'manual_review');
CREATE TYPE "AnalyticsInsightAttemptStatus" AS ENUM ('running', 'succeeded', 'failed', 'manual_review');

ALTER TABLE "AnalyticsDailyMetric"
  ADD COLUMN "consentVersion" INTEGER NOT NULL DEFAULT 1,
  ADD CONSTRAINT "AnalyticsDailyMetric_consent_check" CHECK ("consentVersion" IN (1, 2));

ALTER TABLE "BookingFunnelAttempt"
  ADD COLUMN "consentVersion" INTEGER NOT NULL DEFAULT 1,
  ADD CONSTRAINT "BookingFunnelAttempt_consent_check" CHECK ("consentVersion" IN (1, 2));

DROP INDEX "AnalyticsDailyMetric_cell_key";
CREATE UNIQUE INDEX "AnalyticsDailyMetric_cell_key" ON "AnalyticsDailyMetric"("businessId", "cohortLocalDate", "businessTimeZone", "definitionVersion", "consentVersion", "population", "grain", "dimensionKey", "metricKey");

CREATE TABLE "AnalyticsInsightPreference" (
  "id" UUID NOT NULL,
  "businessId" TEXT NOT NULL,
  "recipientUserId" TEXT,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "aiNarrativeEnabled" BOOLEAN NOT NULL DEFAULT false,
  "emailEnabled" BOOLEAN NOT NULL DEFAULT false,
  "privacyVersion" INTEGER,
  "acceptedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AnalyticsInsightPreference_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AnalyticsWeeklyInsight" (
  "id" UUID NOT NULL,
  "businessId" TEXT NOT NULL,
  "weekStart" DATE NOT NULL,
  "weekEnd" DATE NOT NULL,
  "businessTimeZone" VARCHAR(100) NOT NULL,
  "sourceConsentVersion" INTEGER NOT NULL,
  "status" "AnalyticsInsightStatus" NOT NULL,
  "generationStatus" "AnalyticsInsightGenerationStatus" NOT NULL DEFAULT 'not_requested',
  "facts" JSONB NOT NULL,
  "narrative" JSONB,
  "reasonCode" VARCHAR(64),
  "inputHash" CHAR(64) NOT NULL,
  "sourceExpiresAt" TIMESTAMP(3) NOT NULL,
  "retentionExpiresAt" TIMESTAMP(3) NOT NULL,
  "narrativeGeneratedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AnalyticsWeeklyInsight_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AnalyticsWeeklyInsight_week_check" CHECK ("weekEnd" > "weekStart"),
  CONSTRAINT "AnalyticsWeeklyInsight_consent_check" CHECK ("sourceConsentVersion" IN (1, 2))
);

CREATE TABLE "AnalyticsInsightGenerationAttempt" (
  "id" UUID NOT NULL,
  "weeklyInsightId" UUID NOT NULL,
  "attemptNumber" INTEGER NOT NULL,
  "status" "AnalyticsInsightAttemptStatus" NOT NULL,
  "leaseToken" UUID,
  "leaseExpiresAt" TIMESTAMP(3),
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  "providerRequestId" VARCHAR(160),
  "inputHash" CHAR(64) NOT NULL,
  "outputTokens" INTEGER,
  "errorCode" VARCHAR(64),
  "nextRetryAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AnalyticsInsightGenerationAttempt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AnalyticsInsightPreference_businessId_key" ON "AnalyticsInsightPreference"("businessId");
CREATE INDEX "AnalyticsInsightPreference_recipientUserId_idx" ON "AnalyticsInsightPreference"("recipientUserId");
CREATE UNIQUE INDEX "AnalyticsWeeklyInsight_businessId_weekStart_key" ON "AnalyticsWeeklyInsight"("businessId", "weekStart");
CREATE INDEX "AnalyticsWeeklyInsight_businessId_status_weekStart_idx" ON "AnalyticsWeeklyInsight"("businessId", "status", "weekStart");
CREATE INDEX "AnalyticsWeeklyInsight_retention_idx" ON "AnalyticsWeeklyInsight"("retentionExpiresAt");
CREATE UNIQUE INDEX "AnalyticsInsightGenerationAttempt_weeklyInsightId_attemptNumber_key" ON "AnalyticsInsightGenerationAttempt"("weeklyInsightId", "attemptNumber");
CREATE INDEX "AnalyticsInsightGenerationAttempt_status_lease_idx" ON "AnalyticsInsightGenerationAttempt"("status", "leaseExpiresAt");

ALTER TABLE "AnalyticsInsightPreference"
  ADD CONSTRAINT "AnalyticsInsightPreference_business_fkey"
  FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "AnalyticsInsightPreference_recipient_fkey"
  FOREIGN KEY ("recipientUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AnalyticsWeeklyInsight"
  ADD CONSTRAINT "AnalyticsWeeklyInsight_business_fkey"
  FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AnalyticsInsightGenerationAttempt"
  ADD CONSTRAINT "AnalyticsInsightGenerationAttempt_weekly_fkey"
  FOREIGN KEY ("weeklyInsightId") REFERENCES "AnalyticsWeeklyInsight"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AnalyticsEmailDelivery"
  ADD COLUMN "recipientUserId" TEXT;

CREATE INDEX "AnalyticsEmailDelivery_recipientUserId_idx" ON "AnalyticsEmailDelivery"("recipientUserId");

ALTER TABLE "AnalyticsEmailDelivery"
  ADD CONSTRAINT "AnalyticsEmailDelivery_recipient_fkey"
  FOREIGN KEY ("recipientUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AnalyticsEmailDelivery"
  ADD CONSTRAINT "AnalyticsEmailDelivery_weekly_fkey"
  FOREIGN KEY ("weeklyInsightId") REFERENCES "AnalyticsWeeklyInsight"("id") ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT;
