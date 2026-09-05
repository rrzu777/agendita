-- Preserve source-consent provenance when a Booking snapshot outlives its
-- analytics session/attempt. NULL remains valid for historical v1 snapshots.
BEGIN;

ALTER TABLE "Booking" ADD COLUMN "analyticsConsentVersion" INTEGER;
ALTER TABLE "Booking" DROP CONSTRAINT "Booking_analytics_snapshot_check";
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_analytics_snapshot_check" CHECK (
  (num_nonnulls("analyticsVersion", "analyticsConsentVersion", "analyticsSessionId", "analyticsAttemptId", "analyticsAttemptStartedAt",
   "analyticsConversionDeadlineAt", "analyticsRetentionExpiresAt", "analyticsChannel", "analyticsNormalizationVersion",
   "analyticsAcquisitionLinkId", "analyticsSelectionRevision") = 0)
  OR
  (num_nonnulls("analyticsVersion", "analyticsSessionId", "analyticsAttemptId", "analyticsAttemptStartedAt",
   "analyticsConversionDeadlineAt", "analyticsRetentionExpiresAt", "analyticsChannel", "analyticsNormalizationVersion") = 8
   AND "analyticsVersion" = 1 AND ("analyticsConsentVersion" IS NULL OR "analyticsConsentVersion" IN (1, 2))
   AND "analyticsNormalizationVersion" = 1
   AND "analyticsConversionDeadlineAt" = "analyticsAttemptStartedAt" + interval '24 hours'
   AND "analyticsRetentionExpiresAt" > "analyticsConversionDeadlineAt"
   AND "analyticsRetentionExpiresAt" <= "analyticsAttemptStartedAt" + interval '90 days'
   AND ("analyticsSelectionRevision" IS NULL OR "analyticsSelectionRevision" > 0))
);

COMMIT;
