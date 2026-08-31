import { describe, expect, it } from 'vitest'
import { createAnalyticsStore } from '@/lib/analytics/client-store'

function storage() {
  const values = new Map<string, string>()
  return { values, getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => { values.set(k, v) }, removeItem: (k: string) => { values.delete(k) } }
}

describe('consented atomic analytics state', () => {
  it('creates no identity, queue or storage before opt-in, including attempted interactions', () => {
    const local = storage(), tab = storage()
    let identities = 0
    const store = createAnalyticsStore({ businessId: 'salon', origin: 'https://example.test', storage: tab, preferences: local, uuid: () => { identities++; return crypto.randomUUID() } })
    store.startAttempt('complete')
    store.track({ type: 'service_considered', data: { serviceId: 'a' } })
    expect(identities).toBe(0)
    expect(tab.values.size).toBe(0)
    expect(local.values.size).toBe(0)
    expect(store.bookingCredential()).toBeUndefined()
  })
  it('persists event, sequence and revision in one atomic write and restores them', () => {
    const local = storage(), tab = storage()
    const options = { businessId: 'salon', origin: 'https://example.test', storage: tab, preferences: local }
    const store = createAnalyticsStore(options)
    store.chooseConsent(true)
    store.open()
    store.startAttempt('complete')
    store.track({ type: 'service_considered', data: { serviceId: 'a' } })
    const restored = createAnalyticsStore(options)
    restored.open()
    expect(restored.snapshot()?.queue.map((q) => q.event.sequence)).toEqual([1, 2])
    expect(restored.snapshot()?.streams.find((s) => s.kind === 'attempt')?.sequence).toBe(2)
    expect(restored.snapshot()?.revision).toBe(1)
  })
  it('preferences are scoped to business and origin, expire at 180 days and withdrawal removes capture', () => {
    const local = storage(), tab = storage()
    let now = 1_800_000_000_000
    const options = { businessId: 'salon', origin: 'https://example.test', storage: tab, preferences: local, now: () => now }
    const store = createAnalyticsStore(options)
    store.chooseConsent(true); store.open(); store.startAttempt('complete')
    expect(createAnalyticsStore({ ...options, businessId: 'other' }).consent()).toBeNull()
    expect(createAnalyticsStore({ ...options, origin: 'https://other.test' }).consent()).toBeNull()
    now += 180 * 86400000
    expect(store.consent()).toBeNull()
    store.chooseConsent(false)
    expect(tab.values.size).toBe(0)
    expect(store.snapshot()).toBeNull()
  })
  it('keeps a still-valid attempt after its parent session expires, omitting only revision after a local gap', () => {
    const local = storage(), tab = storage()
    let now = Date.parse('2026-08-31T10:00:00Z')
    const store = createAnalyticsStore({ businessId: 'salon', origin: 'https://example.test', storage: tab, preferences: local, now: () => now })
    store.chooseConsent(true); store.open(); store.startAttempt('complete')
    const receipt = { id: crypto.randomUUID(), credential: 'signed-attempt', startedAt: new Date(now).toISOString(), expiresAt: new Date(now + 86400000).toISOString(), retentionExpiresAt: new Date(now + 90 * 86400000).toISOString() }
    store.mutate((state) => {
      state.streams.find((s) => s.kind === 'session')!.receipt = { ...receipt, expiresAt: new Date(now + 1000).toISOString() }
      state.streams.find((s) => s.key === state.active)!.receipt = receipt
    })
    now += 2000
    store.startAttempt('partial')
    expect(store.bookingCredential()).toEqual({ credential: 'signed-attempt', selectionRevision: 1 })
    now += 300001
    store.expireQueue()
    expect(store.bookingCredential()).toEqual({ credential: 'signed-attempt' })
    store.track({ type: 'step_viewed', data: { step: 'payment' } })
    expect(store.snapshot()?.queue[0].event.sequence).toBe(2)
  })
  it('caps the queue at 100 without sequence reuse and fails closed when the atomic write fails', () => {
    const local = storage(), tab = storage()
    const store = createAnalyticsStore({ businessId: 'salon', origin: 'https://example.test', storage: tab, preferences: local })
    store.chooseConsent(true); store.open(); store.startAttempt('complete')
    for (let i = 0; i < 110; i++) store.track({ type: 'step_viewed', data: { step: 'service' } })
    expect(store.snapshot()?.queue.length).toBe(100)
    expect(store.snapshot()?.streams.find((s) => s.key === store.snapshot()?.active)).toMatchObject({ sequence: 111, gap: true })
    tab.setItem = () => { throw new Error('quota') }
    expect(() => store.changeSelection({ reason: 'time', context: null, localDate: null })).not.toThrow()
    expect(store.snapshot()).toBeNull(); expect(store.bookingCredential()).toBeUndefined()
  })
  it('renews an expired surface session on reload without replacing its still-valid attempt', () => {
    const local = storage(), tab = storage()
    let now = Date.parse('2026-08-31T10:00:00Z')
    const options = { businessId: 'salon', origin: 'https://example.test', storage: tab, preferences: local, now: () => now }
    const store = createAnalyticsStore(options)
    store.chooseConsent(true); store.open(); store.startAttempt('complete')
    const original = store.snapshot()!
    const receipt = { id: crypto.randomUUID(), credential: 'still-valid', startedAt: new Date(now).toISOString(), expiresAt: new Date(now + 86400000).toISOString(), retentionExpiresAt: new Date(now + 90 * 86400000).toISOString() }
    store.mutate((state) => {
      state.streams.find((s) => s.kind === 'session')!.receipt = { ...receipt, expiresAt: new Date(now + 1000).toISOString() }
      state.streams.find((s) => s.key === state.active)!.receipt = receipt
    })
    now += 2000
    const restored = createAnalyticsStore(options); restored.open()
    expect(restored.snapshot()?.session).not.toBe(original.session)
    expect(restored.snapshot()?.active).toBe(original.active)
    expect(restored.bookingCredential()?.credential).toBe('still-valid')
  })
  it('refuses malformed stored stream identity/kind instead of transporting arbitrary local payloads', () => {
    const local = storage(), tab = storage()
    const options = { businessId: 'salon', origin: 'https://example.test', storage: tab, preferences: local }
    const store = createAnalyticsStore(options); store.chooseConsent(true); store.open()
    const state = store.snapshot()!
    state.streams[0].kind = '../../other-api' as 'session'
    tab.setItem(store.keys.state, JSON.stringify(state))
    const restored = createAnalyticsStore(options)
    expect(restored.open()).toBe(false)
    expect(restored.snapshot()).toBeNull()
  })
  it('does not mint replacement identities when capture is disabled before a lifetime expires', () => {
    const local = storage(), tab = storage()
    const options = { businessId: 'salon', origin: 'https://example.test', storage: tab, preferences: local }
    const store = createAnalyticsStore(options); store.chooseConsent(true); store.open(); store.startAttempt('complete')
    const original = store.snapshot()!
    store.mutate((state) => { for (const stream of state.streams) stream.disabled = true })
    const restored = createAnalyticsStore(options); restored.open(); restored.startAttempt('complete')
    expect(restored.snapshot()?.session).toBe(original.session)
    expect(restored.snapshot()?.active).toBe(original.active)
  })
  it('a genuinely new attempt does not inherit the previous attempt restore signature', () => {
    const local = storage(), tab = storage()
    const store = createAnalyticsStore({ businessId: 'salon', origin: 'https://example.test', storage: tab, preferences: local })
    store.chooseConsent(true); store.open(); store.startAttempt('complete'); store.rememberSelection('previous-selection')
    store.completeAttempt(); store.startAttempt('partial'); store.reconcileSelection('new-selection')
    expect(store.snapshot()?.revision).toBe(1)
    expect(store.snapshot()?.streams.find((s) => s.key === store.snapshot()?.active)?.gap).toBe(false)
  })
})
