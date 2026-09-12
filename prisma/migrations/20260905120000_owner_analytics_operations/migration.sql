-- Durable owner-analytics operation state. Feature flags remain disabled by default.
BEGIN;

CREATE TYPE "AnalyticsJobStatus" AS ENUM ('running', 'succeeded', 'partial', 'failed');
CREATE TYPE "AnalyticsIncidentType" AS ENUM ('heartbeat_stale', 'maintenance_failures', 'retention_backlog');
CREATE TYPE "AnalyticsIncidentSeverity" AS ENUM ('warning', 'critical');
CREATE TYPE "AnalyticsIncidentNotificationStatus" AS ENUM ('pending', 'sent', 'failed', 'skipped');
CREATE TYPE "AnalyticsEmailDeliveryStatus" AS ENUM ('pending', 'sending', 'sent', 'failed', 'ambiguous', 'manual_review', 'cancelled');
CREATE TYPE "AnalyticsEmailNotificationKind" AS ENUM ('alert_open', 'alert_escalation', 'alert_reminder', 'alert_beyond_tolerance', 'alert_resolved', 'weekly_digest');

CREATE TABLE "AnalyticsJobHeartbeat" (
  "jobKey" VARCHAR(64) NOT NULL,
  "currentRunId" UUID,
  "leaseToken" UUID,
  "leaseExpiresAt" TIMESTAMP(3),
  "lastStartedAt" TIMESTAMP(3),
  "lastCompletedAt" TIMESTAMP(3),
  "lastSuccessAt" TIMESTAMP(3),
  "lastProgressAt" TIMESTAMP(3),
  "lastStatus" "AnalyticsJobStatus",
  "nextBatchSequence" INTEGER,
  "runErrors" INTEGER NOT NULL DEFAULT 0,
  "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
  "consecutiveSuccesses" INTEGER NOT NULL DEFAULT 0,
  "circuitOpenUntil" TIMESTAMP(3),
  "probeLeaseUntil" TIMESTAMP(3),
  "lastResult" JSONB,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AnalyticsJobHeartbeat_pkey" PRIMARY KEY ("jobKey")
);

CREATE TABLE "AnalyticsOperationalIncident" (
  "id" UUID NOT NULL,
  "activeKey" VARCHAR(160),
  "incidentType" "AnalyticsIncidentType" NOT NULL,
  "severity" "AnalyticsIncidentSeverity" NOT NULL,
  "openedAt" TIMESTAMP(3) NOT NULL,
  "lastObservedAt" TIMESTAMP(3) NOT NULL,
  "resolvedAt" TIMESTAMP(3),
  "lastNotifiedSeverity" "AnalyticsIncidentSeverity",
  "lastNotificationAt" TIMESTAMP(3),
  "notificationAttempts" INTEGER NOT NULL DEFAULT 0,
  "lastNotificationStatus" "AnalyticsIncidentNotificationStatus",
  "lastNotificationCode" VARCHAR(64),
  "details" JSONB NOT NULL,
  "healthySince" TIMESTAMP(3),
  "retentionExpiresAt" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AnalyticsOperationalIncident_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AnalyticsEmailDelivery" (
  "id" UUID NOT NULL,
  "incidentId" UUID,
  "weeklyInsightId" UUID,
  "dedupeKey" VARCHAR(220) NOT NULL,
  "notificationKind" "AnalyticsEmailNotificationKind" NOT NULL,
  "payloadHash" CHAR(64) NOT NULL,
  "recipients" JSONB NOT NULL,
  "subject" VARCHAR(200) NOT NULL,
  "htmlBody" TEXT NOT NULL,
  "textBody" TEXT NOT NULL,
  "status" "AnalyticsEmailDeliveryStatus" NOT NULL DEFAULT 'pending',
  "leaseToken" UUID,
  "leaseExpiresAt" TIMESTAMP(3),
  "firstProviderAttemptAt" TIMESTAMP(3),
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMP(3),
  "providerMessageId" VARCHAR(160),
  "lastFailureCode" VARCHAR(64),
  "sentAt" TIMESTAMP(3),
  "retentionExpiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AnalyticsEmailDelivery_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AnalyticsEmailDelivery_parent_check" CHECK (num_nonnulls("incidentId", "weeklyInsightId") = 1)
);

CREATE UNIQUE INDEX "AnalyticsOperationalIncident_activeKey_key" ON "AnalyticsOperationalIncident"("activeKey");
CREATE UNIQUE INDEX "AnalyticsEmailDelivery_dedupeKey_key" ON "AnalyticsEmailDelivery"("dedupeKey");
CREATE INDEX "AnalyticsJobHeartbeat_status_success_idx" ON "AnalyticsJobHeartbeat"("lastStatus", "lastSuccessAt");
CREATE INDEX "AnalyticsJobHeartbeat_lease_idx" ON "AnalyticsJobHeartbeat"("leaseExpiresAt");
CREATE INDEX "AnalyticsOperationalIncident_type_resolved_idx" ON "AnalyticsOperationalIncident"("incidentType", "resolvedAt");
CREATE INDEX "AnalyticsOperationalIncident_retention_idx" ON "AnalyticsOperationalIncident"("retentionExpiresAt");
CREATE INDEX "AnalyticsEmailDelivery_status_retry_idx" ON "AnalyticsEmailDelivery"("status", "nextAttemptAt");
CREATE INDEX "AnalyticsEmailDelivery_incident_idx" ON "AnalyticsEmailDelivery"("incidentId");
CREATE INDEX "AnalyticsEmailDelivery_weekly_idx" ON "AnalyticsEmailDelivery"("weeklyInsightId");
CREATE INDEX "AnalyticsEmailDelivery_retention_idx" ON "AnalyticsEmailDelivery"("retentionExpiresAt");

ALTER TABLE "AnalyticsEmailDelivery"
  ADD CONSTRAINT "AnalyticsEmailDelivery_incident_fkey"
  FOREIGN KEY ("incidentId") REFERENCES "AnalyticsOperationalIncident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT;
