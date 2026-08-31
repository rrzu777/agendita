import { z } from 'zod'
import type { AnalyticsStore, ClientStream, QueueItem } from './client-store'
import { ANALYTICS_POLICY as policy } from './policy'

const bootstrapSchema = z.strictObject({ id: z.uuid(), credential: z.string().min(1).max(4096), startedAt: z.iso.datetime(), expiresAt: z.iso.datetime(), retentionExpiresAt: z.iso.datetime() })
const receiptSchema = z.strictObject({ receipts: z.array(z.strictObject({ index: z.number().int().min(0).max(19), eventId: z.uuid().nullable(), status: z.enum(['accepted', 'replay', 'rejected']), category: z.enum(['stored', 'identical', 'invalid_event', 'wrong_scope', 'foreign_dimension', 'conflict', 'stream_limit', 'budget']) })).max(20), captureGapRecorded: z.literal(true).optional() })
export interface TransportOptions { fetcher?: (url: string, init: RequestInit) => Promise<Response>; acquisition?: { acq?: string; utmSource?: string; utmMedium?: string; utmCampaign?: string; referrerHost?: string } }

/** One flight, bounded retries and immutable stream bindings survive remounts and lost replies. */
export function createAnalyticsTransport(store: AnalyticsStore, slug: string, options: TransportOptions = {}) {
  let flight: Promise<void> | null = null
  let stopped = false
  const abort = new AbortController()
  const fetcher = options.fetcher ?? fetch
  async function post(kind: string, payload: unknown) {
    if (stopped || store.consent() !== true || !store.snapshot()) throw new Error('stopped')
    const response = await fetcher(`/api/analytics/${encodeURIComponent(slug)}/${kind}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), credentials: 'same-origin', cache: 'no-store', keepalive: true, signal: AbortSignal.any([abort.signal, AbortSignal.timeout(8000)]) })
    if (!response.ok) throw Object.assign(new Error('capture'), { terminal: response.status !== 429 && response.status < 500 })
    const result: unknown = await response.json()
    if (stopped || store.consent() !== true || !store.snapshot()) throw new Error('stopped')
    return result
  }
  function failure(stream: ClientStream, items: QueueItem[], error: unknown) {
    if (stopped) return
    const terminal = !!(error && typeof error === 'object' && 'terminal' in error && error.terminal)
    store.mutate((next) => {
      const s = next.streams.find((s) => s.key === stream.key)
      if (!s) return
      if (!s.receipt || items.length === 0) {
        s.retries++; s.retryAt = store.now() + 1000 * 2 ** s.retries
        if (terminal || s.retries > policy.transientRetries) s.disabled = true
      }
      const ids = new Set(items.map((q) => q.event.eventId))
      next.queue = next.queue.filter((q) => {
        if (!ids.has(q.event.eventId)) return true
        q.retries++; q.retryAt = store.now() + 1000 * 2 ** q.retries
        if (terminal || q.retries > policy.transientRetries) { s.gap = true; return false }
        return true
      })
    })
  }
  async function run() {
    store.expireQueue()
    // Session parents precede attempts. Existing attempts never depend on session renewal.
    for (const stream of store.snapshot()?.streams ?? []) {
      if (stream.disabled || stream.retryAt > store.now()) continue
      if (!stream.receipt) {
        const snapshot = store.snapshot()
        const observed = snapshot?.queue.some((q) => q.stream === stream.key || (stream.kind === 'session' && snapshot.streams.some((s) => s.key === q.stream && s.parent === stream.key)))
        if (!observed && !stream.gap) continue
        const parent = store.snapshot()?.streams.find((s) => s.key === stream.parent)
        const sends = stream.bootstrapSends ?? stream.retries
        if (sends >= 1 + policy.transientRetries) {
          store.mutate(next => { const s = next.streams.find(s => s.key === stream.key); if (s) s.disabled = true })
          continue
        }
        if (stream.kind === 'attempt') {
          if (!parent?.receipt) continue
          const parentEnd = Date.parse(parent.receipt.expiresAt)
          // Only retry an already-sent bootstrap, with its original parent/key.
          // Server recovery independently requires an existing still-live DB attempt.
          if (parentEnd <= store.now() && !(sends > 0 && stream.createdAt < parentEnd && store.now() < parentEnd + policy.conversionWindowMs)) continue
        }
        // Write-ahead send budget survives a crash after DB commit but before
        // response/catch. Storage failure must prevent the network request.
        if (!store.mutate(next => { const s = next.streams.find(s => s.key === stream.key); if (s) { s.bootstrapSends = sends + 1; s.retryAt = store.now() + 1000 * 2 ** (sends + 1) } })) continue
        try {
          const payload = stream.kind === 'session'
            ? { bootstrapKey: stream.key, consent: true, consentVersion: 1, ...options.acquisition }
            : { bootstrapKey: stream.key, credential: parent!.receipt!.credential, entryKind: stream.entryKind }
          const receipt = bootstrapSchema.parse(await post(stream.kind, payload))
          store.mutate((next) => { const s = next.streams.find((s) => s.key === stream.key); if (s) { s.receipt = receipt; s.retries = 0; s.retryAt = 0 } })
        } catch (error) { failure(stream, [], error) }
      }
    }
    for (const stream of store.snapshot()?.streams ?? []) {
      if (stream.disabled || !stream.receipt || Date.parse(stream.receipt.expiresAt) <= store.now() || stream.retryAt > store.now()) continue
      const candidates = store.snapshot()!.queue.filter((q) => q.stream === stream.key && q.retryAt <= store.now())
      const captureGap = stream.gap && !stream.gapRecorded
      const items: QueueItem[] = []
      for (const q of candidates.slice(0, policy.batchEvents)) {
        const body = { credential: stream.receipt.credential, events: [...items, q].map((x) => x.event), ...(captureGap ? { captureGap: true } : {}) }
        if (new TextEncoder().encode(JSON.stringify(body)).byteLength > policy.batchBytes) break
        items.push(q)
      }
      if (!items.length && !captureGap) continue
      try {
        const result = receiptSchema.parse(await post('events', { credential: stream.receipt.credential, events: items.map((q) => q.event), ...(captureGap ? { captureGap: true } : {}) }))
        store.mutate((next) => {
          const s = next.streams.find((s) => s.key === stream.key)
          if (!s) return
          if (captureGap && result.captureGapRecorded) s.gapRecorded = true
          const remove = new Set<string>()
          for (const receipt of result.receipts) {
            const item = items[receipt.index]
            if (!item || receipt.eventId !== item.event.eventId) continue
            remove.add(item.event.eventId)
            if (receipt.status === 'rejected') s.gap = true
          }
          next.queue = next.queue.filter((q) => !remove.has(q.event.eventId))
        })
        // A partial/malformed receipt is not an acknowledgement for omitted elements.
        const remaining = store.snapshot()?.queue.filter((q) => items.some((sent) => sent.event.eventId === q.event.eventId)) ?? []
        if (remaining.length || (captureGap && !result.captureGapRecorded)) failure(stream, remaining, new Error('partial'))
      } catch (error) { failure(stream, items, error) }
    }
  }
  return {
    flush() {
      if (stopped) return Promise.resolve()
      if (!flight) flight = run().catch(() => {}).finally(() => { flight = null })
      return flight
    },
    stop() { stopped = true; abort.abort() },
  }
}
