-- Versioned source-consent rotation. v1 remains the default; v2 is only
-- usable after the application/legal/pilot gates explicitly opt into it.
BEGIN;

ALTER TABLE "AnalyticsSession" DROP CONSTRAINT "AnalyticsSession_contract_check";
ALTER TABLE "AnalyticsSession" ADD CONSTRAINT "AnalyticsSession_contract_check" CHECK (
  "consentVersion" IN (1, 2) AND "definitionVersion" = 1 AND "normalizationVersion" = 1 AND
  "acceptedEventCount" BETWEEN 0 AND 200 AND "origin" ~ '^https?://[^/?#@[:space:]]+$'
);

ALTER TABLE "AnalyticsCollectionPeriod" DROP CONSTRAINT "AnalyticsCollectionPeriod_interval_check";
ALTER TABLE "AnalyticsCollectionPeriod" ADD CONSTRAINT "AnalyticsCollectionPeriod_interval_check" CHECK (
  "definitionVersion" = 1 AND "consentVersion" IN (1, 2) AND
  (("endedAt" IS NULL AND "closeReason" IS NULL) OR
   ("endedAt" IS NOT NULL AND "endedAt" >= "startedAt" AND "closeReason" IS NOT NULL AND
    "closeReason" IN ('operator', 'budget', 'backlog', 'kill_switch', 'version_change')))
);

COMMIT;
