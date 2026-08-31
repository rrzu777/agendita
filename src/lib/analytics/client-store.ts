import { analyticsEventSchema, eventScope, type AnalyticsEventInput } from './contracts'
import { ANALYTICS_POLICY as policy } from './policy'
import { z } from 'zod'

type Draft<E = AnalyticsEventInput> = E extends AnalyticsEventInput ? Pick<E, 'type' | 'data'> : never
export type AnalyticsDraft = Draft
export type SelectionChange = Extract<AnalyticsDraft, { type: 'selection_context_changed' }>['data']
export type StoragePort = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
export interface BootstrapReceipt { id: string; credential: string; startedAt: string; expiresAt: string; retentionExpiresAt: string }
export interface ClientStream {
  key: string; kind: 'session' | 'attempt'; parent?: string; entryKind?: 'complete' | 'partial'
  receipt?: BootstrapReceipt; sequence: number; completed: boolean; gap: boolean
  retries: number; retryAt: number; disabled: boolean; gapRecorded?: boolean; completedRevision?: number; createdAt: number
}
export interface QueueItem { stream: string; event: AnalyticsEventInput; queuedAt: number; retries: number; retryAt: number }
export interface ClientState {
  version: 1; owner: string; streams: ClientStream[]; session: string; active: string | null
  revision: number; selection: SelectionChange | null; queue: QueueItem[]; selectionSignature?: string; viewed?: string[]
}
export interface StoreOptions {
  businessId: string; origin: string; storage: StoragePort; preferences: StoragePort
  now?: () => number; uuid?: () => string
}

const timestamp = z.number().finite().nonnegative()
const streamSchema = z.strictObject({ key: z.uuid(), kind: z.enum(['session', 'attempt']), parent: z.uuid().optional(), entryKind: z.enum(['complete', 'partial']).optional(), receipt: z.strictObject({ id: z.uuid(), credential: z.string().min(1).max(4096), startedAt: z.iso.datetime(), expiresAt: z.iso.datetime(), retentionExpiresAt: z.iso.datetime() }).optional(), sequence: z.number().int().nonnegative().max(2147483647), completed: z.boolean(), gap: z.boolean(), retries: z.number().int().nonnegative(), retryAt: timestamp, disabled: z.boolean(), gapRecorded: z.boolean().optional(), completedRevision: z.number().int().positive().optional(), createdAt: timestamp })
const stateSchema = z.strictObject({ version: z.literal(1), owner: z.uuid(), streams: z.array(streamSchema).max(200), session: z.uuid(), active: z.uuid().nullable(), revision: z.number().int().positive().max(2147483647), selection: z.unknown(), selectionSignature: z.string().max(1500).optional(), viewed: z.array(z.string().max(150)).max(30).optional(), queue: z.array(z.strictObject({ stream: z.uuid(), event: analyticsEventSchema, queuedAt: timestamp, retries: z.number().int().nonnegative(), retryAt: timestamp })).max(policy.queueEvents) })

/** Preference is origin-local, additionally namespaced by the exact origin and tenant. */
export function analyticsStorageKeys(businessId: string, origin: string) {
  const scope = encodeURIComponent(`${origin}|${businessId}`)
  return { preference: `owner-analytics:consent:v1:${scope}`, state: `owner-analytics:tab:v1:${scope}` }
}

/** All mutations use one sessionStorage replacement. Failure disables capture, never Booking. */
export function createAnalyticsStore(options: StoreOptions) {
  const now = options.now ?? Date.now
  const uuid = options.uuid ?? (() => crypto.randomUUID())
  const keys = analyticsStorageKeys(options.businessId, options.origin)
  let state: ClientState | null = null
  let healthy = true
  function clear() {
    state = null
    try { options.storage.removeItem(keys.state) } catch { healthy = false }
  }
  function consent(): boolean | null {
    try {
      const value = JSON.parse(options.preferences.getItem(keys.preference) ?? 'null')
      return value?.version === 1 && typeof value.allowed === 'boolean' && value.expiresAt > now() ? value.allowed : null
    } catch { return null }
  }
  function commit(next: ClientState): boolean {
    if (!healthy || consent() !== true) return false
    try { options.storage.setItem(keys.state, JSON.stringify(next)); state = next; return true }
    catch { healthy = false; state = null; return false }
  }
  function mutate(change: (next: ClientState) => void): boolean {
    if (!state || !healthy || consent() !== true) return false
    const next: ClientState = structuredClone(state)
    change(next)
    return commit(next)
  }
  function stream(kind: ClientStream['kind']): ClientStream {
    return { key: uuid(), kind, sequence: 0, completed: false, gap: false, retries: 0, retryAt: 0, disabled: false, createdAt: now() }
  }
  function valid(s?: ClientStream) { return s && (s.receipt ? Date.parse(s.receipt.expiresAt) > now() : s.createdAt + policy.sessionWindowMs > now()) }
  function renewSession(next: ClientState) {
    if (!valid(next.streams.find((s) => s.key === next.session))) {
      const session = stream('session'); next.streams.push(session); next.session = session.key
    }
    const retained = new Set(next.streams.filter((s) => s.receipt ? Date.parse(s.receipt.retentionExpiresAt) > now() : s.createdAt + policy.sessionWindowMs > now()).map((s) => s.key))
    next.streams = next.streams.filter((s) => retained.has(s.key))
    next.queue = next.queue.filter((q) => retained.has(q.stream))
    if (next.active && !retained.has(next.active)) next.active = null
  }
  function add(next: ClientState, draft: AnalyticsDraft, binding?: string) {
    const scope = eventScope(draft.type)
    const target = next.streams.find((s) => s.key === (binding ?? (scope === 'session' ? next.session : next.active)))
    if (!valid(target) || !target || target.disabled || target.kind !== scope) return
    const sequence = ++target.sequence
    const result = analyticsEventSchema.safeParse({ ...draft, version: 1, eventId: uuid(), sequence, ...(scope === 'attempt' ? { selectionRevision: binding ? target.completedRevision ?? next.revision : next.revision } : {}) })
    if (!result.success || next.queue.length >= policy.queueEvents || sequence > policy.streamEvents) { target.gap = true; return }
    next.queue.push({ stream: target.key, event: result.data, queuedAt: now(), retries: 0, retryAt: 0 })
  }
  return {
    keys, consent, now, discardState: clear,
    snapshot: () => state ? structuredClone(state) : null,
    mutate,
    chooseConsent(allowed: boolean) {
      if (!allowed) clear()
      try { options.preferences.setItem(keys.preference, JSON.stringify({ version: 1, allowed, expiresAt: now() + policy.consentPreferenceMs })) }
      catch { clear(); healthy = false }
    },
    /** Caller MUST acquire the origin-wide owner lock before recording or transporting. */
    open() {
      if (consent() !== true || !healthy) return false
      try {
        const raw = options.storage.getItem(keys.state)
        if (raw) {
          const saved = stateSchema.safeParse(JSON.parse(raw))
          if (!saved.success) { healthy = false; return false }
          state = saved.data as ClientState
          return mutate(renewSession)
        }
        const session = stream('session')
        return commit({ version: 1, owner: uuid(), streams: [session], session: session.key, active: null, revision: 1, selection: null, queue: [] })
      } catch { healthy = false; return false }
    },
    startAttempt(entryKind: 'complete' | 'partial') {
      mutate((next) => {
        if (valid(next.streams.find((s) => s.key === next.active))) return
        let session = next.streams.find((s) => s.key === next.session)
        if (!valid(session)) { session = stream('session'); next.streams.push(session); next.session = session.key }
        const attempt = { ...stream('attempt'), parent: next.session, entryKind }
        next.streams.push(attempt); next.active = attempt.key; next.revision = 1; next.selection = null; delete next.selectionSignature
        if (entryKind === 'complete') add(next, { type: 'funnel_started', data: {} })
      })
    },
    track(draft: AnalyticsDraft, binding?: string) { mutate((next) => add(next, draft, binding)) },
    view(draft: AnalyticsDraft, key: string) {
      mutate((next) => {
        renewSession(next)
        const scoped = `${next.session}:${key}`
        if (next.viewed?.includes(scoped)) return
        next.viewed = [...(next.viewed ?? []), scoped].slice(-30)
        add(next, draft)
      })
    },
    rememberSelection(signature: string) { mutate((next) => { next.selectionSignature = signature }) },
    reconcileSelection(signature: string) {
      if (state?.selectionSignature && state.selectionSignature !== signature) {
        this.changeSelection({ reason: 'restore', context: null, localDate: null })
        mutate((next) => { const s = next.streams.find((s) => s.key === next.active); if (s) s.gap = true })
      }
      this.rememberSelection(signature)
    },
    changeSelection(data: SelectionChange) {
      mutate((next) => { next.revision++; next.selection = data; add(next, { type: 'selection_context_changed', data }) })
    },
    completeAttempt() {
      const binding = state?.active ?? undefined
      mutate((next) => { const attempt = next.streams.find((s) => s.key === next.active); if (attempt) { attempt.completed = true; attempt.completedRevision = next.revision }; next.active = null })
      return binding
    },
    bookingCredential() {
      if (!healthy || consent() !== true) return undefined
      const attempt = state?.streams.find((s) => s.key === state?.active)
      return attempt?.receipt && Date.parse(attempt.receipt.expiresAt) > now() ? { credential: attempt.receipt.credential, ...(!attempt.gap ? { selectionRevision: state!.revision } : {}) } : undefined
    },
    expireQueue() {
      mutate((next) => {
        next.queue = next.queue.filter((q) => {
          const keep = now() - q.queuedAt <= policy.maxUnsentAgeMs
          if (!keep) { const s = next.streams.find((s) => s.key === q.stream); if (s) s.gap = true }
          return keep
        })
      })
    },
    withdrawConsent() { this.chooseConsent(false) },
    stop() { healthy = false; state = null },
  }
}
export type AnalyticsStore = ReturnType<typeof createAnalyticsStore>
