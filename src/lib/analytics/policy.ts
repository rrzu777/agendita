/** Defaults are fail-closed. Enabling capture additionally requires validated budgets and a distributed limiter. */
export const ANALYTICS_POLICY = Object.freeze({
  enabledByDefault: false, version: 1, definitionVersion: 1, consentVersion: 1,
  conversionWindowMs: 24 * 60 * 60 * 1000, sessionWindowMs: 24 * 60 * 60 * 1000,
  rawRetentionMs: 90 * 24 * 60 * 60 * 1000, aggregateRetentionMs: 90 * 24 * 60 * 60 * 1000,
  consentPreferenceMs: 180 * 24 * 60 * 60 * 1000, reconciliationMarginMs: 60 * 60 * 1000,
  batchEvents: 20, batchBytes: 16 * 1024, streamEvents: 200, bootstrapsPerMinute: 10,
  batchesPerMinute: 30, queueEvents: 100, flushIntervalMs: 5000, transientRetries: 2,
  maxUnsentAgeMs: 5 * 60 * 1000, cleanupBatchRows: 1000, cleanupInvocationRows: 10000,
  backlogPauseMs: 12 * 60 * 60 * 1000,
})
