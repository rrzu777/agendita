-- Additive owner-analytics storage. Apply only after rollout authorization outside local QA.
BEGIN;

-- CreateEnum
CREATE TYPE "AnalyticsChannel" AS ENUM ('direct', 'instagram', 'facebook', 'whatsapp', 'google', 'referral', 'other', 'unknown');

-- CreateEnum
CREATE TYPE "AnalyticsEntryKind" AS ENUM ('complete', 'partial');

-- CreateEnum
CREATE TYPE "AnalyticsEventScope" AS ENUM ('session', 'attempt');

-- CreateEnum
CREATE TYPE "AnalyticsEventType" AS ENUM ('public_profile_viewed', 'booking_entry_viewed', 'funnel_started', 'step_viewed', 'service_considered', 'service_selected', 'professional_selected', 'date_selected', 'time_selected', 'availability_result', 'customer_step_completed', 'promotion_result', 'payment_branch_viewed', 'payment_method_selected', 'booking_submit_result', 'selection_context_changed', 'checkout_redirected');

-- CreateEnum
CREATE TYPE "AnalyticsPopulation" AS ENUM ('sessions', 'complete_attempts', 'partial_attempts');

-- CreateEnum
CREATE TYPE "AnalyticsGrain" AS ENUM ('total', 'channel', 'acquisition_link', 'service');

-- CreateEnum
CREATE TYPE "AnalyticsPublicationState" AS ENUM ('provisional', 'closed', 'failed');

-- CreateEnum
CREATE TYPE "AnalyticsCoverageState" AS ENUM ('complete', 'partial', 'disabled', 'unknown');

-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "analyticsAcquisitionLinkId" TEXT,
ADD COLUMN     "analyticsAttemptId" UUID,
ADD COLUMN     "analyticsAttemptStartedAt" TIMESTAMP(3),
ADD COLUMN     "analyticsChannel" "AnalyticsChannel",
ADD COLUMN     "analyticsConversionDeadlineAt" TIMESTAMP(3),
ADD COLUMN     "analyticsNormalizationVersion" INTEGER,
ADD COLUMN     "analyticsRetentionExpiresAt" TIMESTAMP(3),
ADD COLUMN     "analyticsSelectionRevision" INTEGER,
ADD COLUMN     "analyticsSessionId" UUID,
ADD COLUMN     "analyticsVersion" INTEGER;

-- CreateTable
CREATE TABLE "AnalyticsSession" (
    "id" UUID NOT NULL,
    "businessId" TEXT NOT NULL,
    "bootstrapKey" UUID NOT NULL,
    "origin" VARCHAR(300) NOT NULL,
    "consentVersion" INTEGER NOT NULL,
    "definitionVersion" INTEGER NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "retentionExpiresAt" TIMESTAMP(3) NOT NULL,
    "businessTimeZone" VARCHAR(100) NOT NULL,
    "cohortLocalDate" DATE NOT NULL,
    "channel" "AnalyticsChannel" NOT NULL,
    "normalizationVersion" INTEGER NOT NULL,
    "acquisitionLinkId" TEXT,
    "acceptedEventCount" INTEGER NOT NULL DEFAULT 0,
    "knownCaptureGap" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "AnalyticsSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BookingFunnelAttempt" (
    "id" UUID NOT NULL,
    "businessId" TEXT NOT NULL,
    "sessionId" UUID NOT NULL,
    "bootstrapKey" UUID NOT NULL,
    "origin" VARCHAR(300) NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "conversionDeadlineAt" TIMESTAMP(3) NOT NULL,
    "retentionExpiresAt" TIMESTAMP(3) NOT NULL,
    "entryKind" "AnalyticsEntryKind" NOT NULL,
    "definitionVersion" INTEGER NOT NULL,
    "businessTimeZone" VARCHAR(100) NOT NULL,
    "cohortLocalDate" DATE NOT NULL,
    "channel" "AnalyticsChannel" NOT NULL,
    "normalizationVersion" INTEGER NOT NULL,
    "acquisitionLinkId" TEXT,
    "acceptedEventCount" INTEGER NOT NULL DEFAULT 0,
    "knownCaptureGap" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "BookingFunnelAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BookingFunnelEvent" (
    "id" UUID NOT NULL,
    "businessId" TEXT NOT NULL,
    "sessionId" UUID NOT NULL,
    "attemptId" UUID,
    "eventId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "scope" "AnalyticsEventScope" NOT NULL,
    "type" "AnalyticsEventType" NOT NULL,
    "streamKey" VARCHAR(50) NOT NULL,
    "sequence" INTEGER NOT NULL,
    "selectionRevision" INTEGER,
    "fingerprint" CHAR(64) NOT NULL,
    "data" JSONB NOT NULL,
    "serviceId" TEXT,
    "modality" "ServiceModality",
    "professionalId" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "retentionExpiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BookingFunnelEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AcquisitionLink" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "token" VARCHAR(64) NOT NULL,
    "channel" "AnalyticsChannel" NOT NULL,
    "campaignName" VARCHAR(100) NOT NULL,
    "promotionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "AcquisitionLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalyticsCollectionPeriod" (
    "id" UUID NOT NULL,
    "businessId" TEXT NOT NULL,
    "definitionVersion" INTEGER NOT NULL,
    "consentVersion" INTEGER NOT NULL,
    "businessTimeZone" VARCHAR(100) NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "closeReason" VARCHAR(32),

    CONSTRAINT "AnalyticsCollectionPeriod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalyticsDailyMetric" (
    "id" UUID NOT NULL,
    "businessId" TEXT NOT NULL,
    "cohortLocalDate" DATE NOT NULL,
    "businessTimeZone" VARCHAR(100) NOT NULL,
    "definitionVersion" INTEGER NOT NULL,
    "population" "AnalyticsPopulation" NOT NULL,
    "grain" "AnalyticsGrain" NOT NULL,
    "dimensionKey" VARCHAR(128) NOT NULL,
    "metricKey" VARCHAR(64) NOT NULL,
    "numerator" INTEGER NOT NULL,
    "denominator" INTEGER NOT NULL,
    "revision" INTEGER NOT NULL,
    "state" "AnalyticsPublicationState" NOT NULL,
    "coverage" "AnalyticsCoverageState" NOT NULL,
    "calculatedAt" TIMESTAMP(3) NOT NULL,
    "cutoffAt" TIMESTAMP(3) NOT NULL,
    "frozenAt" TIMESTAMP(3),
    "retentionExpiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AnalyticsDailyMetric_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AnalyticsSession_businessId_startedAt_id_idx" ON "AnalyticsSession"("businessId", "startedAt", "id");

-- CreateIndex
CREATE INDEX "AnalyticsSession_retentionExpiresAt_id_idx" ON "AnalyticsSession"("retentionExpiresAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "AnalyticsSession_businessId_id_key" ON "AnalyticsSession"("businessId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "AnalyticsSession_businessId_bootstrapKey_key" ON "AnalyticsSession"("businessId", "bootstrapKey");

-- CreateIndex
CREATE INDEX "BookingFunnelAttempt_businessId_startedAt_id_idx" ON "BookingFunnelAttempt"("businessId", "startedAt", "id");

-- CreateIndex
CREATE INDEX "BookingFunnelAttempt_retentionExpiresAt_id_idx" ON "BookingFunnelAttempt"("retentionExpiresAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "BookingFunnelAttempt_businessId_sessionId_id_key" ON "BookingFunnelAttempt"("businessId", "sessionId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "BookingFunnelAttempt_businessId_bootstrapKey_key" ON "BookingFunnelAttempt"("businessId", "bootstrapKey");

-- CreateIndex
CREATE INDEX "BookingFunnelEvent_businessId_receivedAt_idx" ON "BookingFunnelEvent"("businessId", "receivedAt");

-- CreateIndex
CREATE INDEX "BookingFunnelEvent_businessId_attemptId_sequence_idx" ON "BookingFunnelEvent"("businessId", "attemptId", "sequence");

-- CreateIndex
CREATE INDEX "BookingFunnelEvent_businessId_sessionId_idx" ON "BookingFunnelEvent"("businessId", "sessionId");

-- CreateIndex
CREATE INDEX "BookingFunnelEvent_retentionExpiresAt_id_idx" ON "BookingFunnelEvent"("retentionExpiresAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "BookingFunnelEvent_businessId_eventId_key" ON "BookingFunnelEvent"("businessId", "eventId");

-- CreateIndex
CREATE UNIQUE INDEX "BookingFunnelEvent_businessId_streamKey_sequence_key" ON "BookingFunnelEvent"("businessId", "streamKey", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "AcquisitionLink_token_key" ON "AcquisitionLink"("token");

-- CreateIndex
CREATE INDEX "AcquisitionLink_businessId_archivedAt_createdAt_idx" ON "AcquisitionLink"("businessId", "archivedAt", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AcquisitionLink_businessId_id_key" ON "AcquisitionLink"("businessId", "id");

-- CreateIndex
CREATE INDEX "AnalyticsCollectionPeriod_businessId_startedAt_id_idx" ON "AnalyticsCollectionPeriod"("businessId", "startedAt", "id");

-- CreateIndex
CREATE INDEX "AnalyticsDailyMetric_businessId_cohortLocalDate_idx" ON "AnalyticsDailyMetric"("businessId", "cohortLocalDate");

-- CreateIndex
CREATE INDEX "AnalyticsDailyMetric_retentionExpiresAt_id_idx" ON "AnalyticsDailyMetric"("retentionExpiresAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "AnalyticsDailyMetric_cell_key" ON "AnalyticsDailyMetric"("businessId", "cohortLocalDate", "businessTimeZone", "definitionVersion", "population", "grain", "dimensionKey", "metricKey");

-- CreateIndex
CREATE INDEX "Booking_businessId_analyticsAttemptId_createdAt_idx" ON "Booking"("businessId", "analyticsAttemptId", "createdAt");

-- CreateIndex
CREATE INDEX "Booking_analyticsRetentionExpiresAt_id_idx" ON "Booking"("analyticsRetentionExpiresAt", "id");

-- AddForeignKey
ALTER TABLE "AnalyticsSession" ADD CONSTRAINT "AnalyticsSession_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingFunnelAttempt" ADD CONSTRAINT "BookingFunnelAttempt_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingFunnelAttempt" ADD CONSTRAINT "BookingFunnelAttempt_businessId_sessionId_fkey" FOREIGN KEY ("businessId", "sessionId") REFERENCES "AnalyticsSession"("businessId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingFunnelEvent" ADD CONSTRAINT "BookingFunnelEvent_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingFunnelEvent" ADD CONSTRAINT "BookingFunnelEvent_businessId_sessionId_fkey" FOREIGN KEY ("businessId", "sessionId") REFERENCES "AnalyticsSession"("businessId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingFunnelEvent" ADD CONSTRAINT "BookingFunnelEvent_businessId_sessionId_attemptId_fkey" FOREIGN KEY ("businessId", "sessionId", "attemptId") REFERENCES "BookingFunnelAttempt"("businessId", "sessionId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AcquisitionLink" ADD CONSTRAINT "AcquisitionLink_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalyticsCollectionPeriod" ADD CONSTRAINT "AnalyticsCollectionPeriod_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalyticsDailyMetric" ADD CONSTRAINT "AnalyticsDailyMetric_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Hand-reviewed constraints not expressible by Prisma's schema.
ALTER TABLE "AnalyticsSession" ADD CONSTRAINT "AnalyticsSession_lifetime_check" CHECK (
  "expiresAt" = "startedAt" + interval '24 hours' AND
  "retentionExpiresAt" = "startedAt" + interval '90 days' AND
  "cohortLocalDate" = ("startedAt" AT TIME ZONE 'UTC' AT TIME ZONE "businessTimeZone")::date
), ADD CONSTRAINT "AnalyticsSession_contract_check" CHECK (
  "consentVersion" = 1 AND "definitionVersion" = 1 AND "normalizationVersion" = 1 AND
  "acceptedEventCount" BETWEEN 0 AND 200 AND "origin" ~ '^https?://[^/?#@[:space:]]+$'
);
ALTER TABLE "BookingFunnelAttempt" ADD CONSTRAINT "BookingFunnelAttempt_lifetime_check" CHECK (
  "conversionDeadlineAt" = "startedAt" + interval '24 hours' AND
  "retentionExpiresAt" > "conversionDeadlineAt" AND "retentionExpiresAt" <= "startedAt" + interval '90 days' AND
  "cohortLocalDate" = ("startedAt" AT TIME ZONE 'UTC' AT TIME ZONE "businessTimeZone")::date
), ADD CONSTRAINT "BookingFunnelAttempt_contract_check" CHECK (
  "definitionVersion" = 1 AND "normalizationVersion" = 1 AND "acceptedEventCount" BETWEEN 0 AND 200 AND
  "origin" ~ '^https?://[^/?#@[:space:]]+$'
);
ALTER TABLE "BookingFunnelEvent" ADD CONSTRAINT "BookingFunnelEvent_scope_check" CHECK (
  ("scope" = 'session' AND "attemptId" IS NULL AND "selectionRevision" IS NULL AND
   "type" IN ('public_profile_viewed', 'booking_entry_viewed') AND "streamKey" = 'session:' || "sessionId"::text)
  OR
  ("scope" = 'attempt' AND "attemptId" IS NOT NULL AND "selectionRevision" IS NOT NULL AND "selectionRevision" > 0 AND
   "type" NOT IN ('public_profile_viewed', 'booking_entry_viewed') AND "streamKey" = 'attempt:' || "attemptId"::text)
), ADD CONSTRAINT "BookingFunnelEvent_contract_check" CHECK (
  "version" = 1 AND "sequence" > 0 AND "fingerprint" ~ '^[a-f0-9]{64}$' AND
  jsonb_typeof("data") = 'object' AND octet_length("data"::text) <= 16384 AND
  "retentionExpiresAt" > "receivedAt"
);
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_analytics_snapshot_check" CHECK (
  (num_nonnulls("analyticsVersion", "analyticsSessionId", "analyticsAttemptId", "analyticsAttemptStartedAt",
   "analyticsConversionDeadlineAt", "analyticsRetentionExpiresAt", "analyticsChannel", "analyticsNormalizationVersion",
   "analyticsAcquisitionLinkId", "analyticsSelectionRevision") = 0)
  OR
  (num_nonnulls("analyticsVersion", "analyticsSessionId", "analyticsAttemptId", "analyticsAttemptStartedAt",
   "analyticsConversionDeadlineAt", "analyticsRetentionExpiresAt", "analyticsChannel", "analyticsNormalizationVersion") = 8
   AND "analyticsVersion" = 1 AND "analyticsNormalizationVersion" = 1
   AND "analyticsConversionDeadlineAt" = "analyticsAttemptStartedAt" + interval '24 hours'
   AND "analyticsRetentionExpiresAt" > "analyticsConversionDeadlineAt"
   AND "analyticsRetentionExpiresAt" <= "analyticsAttemptStartedAt" + interval '90 days'
   AND ("analyticsSelectionRevision" IS NULL OR "analyticsSelectionRevision" > 0))
);
ALTER TABLE "AcquisitionLink" ADD CONSTRAINT "AcquisitionLink_contract_check" CHECK (
  length(trim("campaignName")) BETWEEN 1 AND 100 AND "token" ~ '^[A-Za-z0-9_-]{22,64}$' AND
  ("archivedAt" IS NULL OR "archivedAt" >= "createdAt")
);
ALTER TABLE "AnalyticsCollectionPeriod" ADD CONSTRAINT "AnalyticsCollectionPeriod_interval_check" CHECK (
  "definitionVersion" = 1 AND "consentVersion" = 1 AND
  (("endedAt" IS NULL AND "closeReason" IS NULL) OR
   ("endedAt" IS NOT NULL AND "endedAt" >= "startedAt" AND "closeReason" IS NOT NULL AND
    "closeReason" IN ('operator', 'budget', 'backlog', 'kill_switch', 'version_change')))
);
CREATE UNIQUE INDEX "AnalyticsCollectionPeriod_one_open" ON "AnalyticsCollectionPeriod"("businessId") WHERE "endedAt" IS NULL;
ALTER TABLE "AnalyticsDailyMetric" ADD CONSTRAINT "AnalyticsDailyMetric_counters_check" CHECK (
  "definitionVersion" = 1 AND "revision" > 0 AND "numerator" >= 0 AND "denominator" >= 0 AND
  "cutoffAt" <= "calculatedAt" AND "retentionExpiresAt" > "cohortLocalDate"::timestamp AND
  ("metricKey" NOT IN ('conversion', 'visit_to_attempt', 'availability_empty', 'service_conversion') OR "numerator" <= "denominator")
), ADD CONSTRAINT "AnalyticsDailyMetric_dimension_check" CHECK (
  length("dimensionKey") > 0 AND
  (("grain" = 'total' AND "dimensionKey" = 'total') OR
   ("grain" = 'channel' AND "dimensionKey" IN ('direct', 'instagram', 'facebook', 'whatsapp', 'google', 'referral', 'other', 'unknown')) OR
   ("grain" IN ('acquisition_link', 'service') AND "dimensionKey" ~ '^[A-Za-z0-9_-]+$'))
), ADD CONSTRAINT "AnalyticsDailyMetric_metric_check" CHECK (
  ("metricKey" = '__publication__' AND "grain" = 'total' AND "dimensionKey" = 'total' AND "numerator" = 0 AND "denominator" = 0)
  OR ("population" = 'sessions' AND "grain" <> 'service' AND "metricKey" IN ('visits', 'visit_to_attempt'))
  OR ("population" IN ('complete_attempts', 'partial_attempts') AND (
    ("grain" = 'service' AND "metricKey" IN ('service_interest', 'service_selected', 'service_conversion', 'service_conversion_unobserved'))
    OR ("grain" <> 'service' AND (
      "metricKey" IN ('attempts', 'conversion', 'bookings_created', 'conversion_path_complete', 'conversion_path_incomplete',
                     'known_interruption', 'measurement_incomplete', 'availability_empty', 'availability_error')
      OR "metricKey" ~ '^milestone:(started|service|professional|date|time|customer|payment|submit)$'
      OR "metricKey" ~ '^last_step:(service|professional|date|time|customer|payment|confirmation)$'
    ))
  ))
);

COMMIT;
