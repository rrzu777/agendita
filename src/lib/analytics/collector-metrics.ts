import 'server-only'
import { performance } from 'node:perf_hooks'
import { recordOperationalMetric, type OperationalMetricSample } from '@/lib/metrics/operational'
import type { BatchReceipt, CaptureErrorCategory, EventReceiptCategory } from './ingest'

export type CollectorOperation = 'session' | 'attempt' | 'events'
export type CollectorTerminalCategory = 'success' | 'disabled_context' | CaptureErrorCategory
const requestOperations: Record<CollectorOperation, string> = {
  session: 'analytics_collector_session',
  attempt: 'analytics_collector_attempt',
  events: 'analytics_collector_events',
}
const requestOutcomes: Record<CollectorTerminalCategory, OperationalMetricSample['outcome']> = {
  success: 'success', disabled_context: 'user_error', invalid_request: 'user_error', invalid_credential: 'user_error',
  disabled: 'user_error', expired: 'user_error', conflict: 'user_error', rate_limit: 'user_error', budget: 'user_error', unavailable: 'error',
}
const receiptMetrics: Record<EventReceiptCategory, { operation: string; status: BatchReceipt['receipts'][number]['status']; outcome: OperationalMetricSample['outcome'] }> = {
  stored: { operation: 'analytics_collector_receipt_accepted_stored', status: 'accepted', outcome: 'success' },
  identical: { operation: 'analytics_collector_receipt_replay_identical', status: 'replay', outcome: 'success' },
  invalid_event: { operation: 'analytics_collector_receipt_rejected_invalid_event', status: 'rejected', outcome: 'user_error' },
  wrong_scope: { operation: 'analytics_collector_receipt_rejected_wrong_scope', status: 'rejected', outcome: 'user_error' },
  foreign_dimension: { operation: 'analytics_collector_receipt_rejected_foreign_dimension', status: 'rejected', outcome: 'user_error' },
  conflict: { operation: 'analytics_collector_receipt_rejected_conflict', status: 'rejected', outcome: 'user_error' },
  stream_limit: { operation: 'analytics_collector_receipt_rejected_stream_limit', status: 'rejected', outcome: 'user_error' },
  budget: { operation: 'analytics_collector_receipt_rejected_budget', status: 'rejected', outcome: 'user_error' },
}

/** One terminal sample per HTTP request, best-effort per instance; never identity counts. */
export function recordCollectorRequest(kind: CollectorOperation, category: CollectorTerminalCategory, startedAt: number): void {
  try {
    if (!Object.hasOwn(requestOperations, kind)) return
    const terminal = Object.hasOwn(requestOutcomes, category) ? category : 'unavailable'
    recordOperationalMetric(`${requestOperations[kind]}_${terminal}`, requestOutcomes[terminal], performance.now() - startedAt)
  } catch { /* Observability must never change capture or its response. */ }
}

/** Call only after commit. Receipt counters use zero duration, not per-event latency. */
export function recordCollectorReceipts(batch: BatchReceipt): void {
  for (const receipt of batch.receipts) {
    try {
      if (!Object.hasOwn(receiptMetrics, receipt.category)) continue
      const metric = receiptMetrics[receipt.category]
      if (receipt.status !== metric.status) continue
      recordOperationalMetric(metric.operation, metric.outcome, 0)
    } catch { /* A failed sample cannot fail the batch or later request sample. */ }
  }
}
