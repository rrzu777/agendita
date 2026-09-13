ALTER TABLE "BookingFunnelAttempt"
ADD COLUMN "flowVersion" INTEGER NOT NULL DEFAULT 1;

CREATE INDEX "BookingFunnelAttempt_businessId_flowVersion_startedAt_idx"
ON "BookingFunnelAttempt"("businessId", "flowVersion", "startedAt");

ALTER TYPE "AnalyticsEventType" ADD VALUE 'service_selection_changed' AFTER 'service_considered';
ALTER TYPE "AnalyticsEventType" ADD VALUE 'availability_preview_result' AFTER 'availability_result';

ALTER TABLE "AnalyticsDailyMetric"
DROP CONSTRAINT "AnalyticsDailyMetric_metric_check",
ADD CONSTRAINT "AnalyticsDailyMetric_metric_check" CHECK (
  ("metricKey" = '__publication__' AND "grain" = 'total' AND "dimensionKey" = 'total' AND "numerator" = 0 AND "denominator" = 0)
  OR ("population" = 'sessions' AND "grain" <> 'service' AND "metricKey" IN ('visits', 'visit_to_attempt'))
  OR ("population" IN ('complete_attempts', 'partial_attempts') AND (
    ("grain" = 'service' AND "metricKey" IN ('service_interest', 'service_selected', 'service_addition', 'service_removal', 'service_incompatible', 'service_conversion', 'service_conversion_unobserved'))
    OR ("grain" <> 'service' AND (
      "metricKey" IN ('attempts', 'conversion', 'bookings_created', 'conversion_path_complete', 'conversion_path_incomplete',
                     'known_interruption', 'measurement_incomplete', 'availability_empty', 'availability_error')
      OR "metricKey" ~ '^milestone:(started|service|professional|date|time|customer|payment|submit)$'
      OR "metricKey" ~ '^last_step:(service|professional|date|time|customer|payment|confirmation)$'
    ))
  ))
);
