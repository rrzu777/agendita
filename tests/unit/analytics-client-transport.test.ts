import { describe, expect, it, vi } from 'vitest'
import { createAnalyticsStore } from '@/lib/analytics/client-store'
import { createAnalyticsTransport } from '@/lib/analytics/client-transport'

function setup() {
  const values = new Map<string, string>()
  const storage = { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => { values.set(k, v) }, removeItem: (k: string) => { values.delete(k) } }
  let clock = Date.parse('2026-08-31T10:00:00Z')
  const store = createAnalyticsStore({ businessId: 'salon', origin: 'https://example.test', storage, preferences: storage, now: () => clock })
  store.chooseConsent(true); store.open(); store.startAttempt('complete')
  const fetcher = vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(init.body as string)
    if ('events' in body) return Response.json({ receipts: body.events.map((e: { eventId: string }, index: number) => ({ index, eventId: e.eventId, status: 'accepted', category: 'stored' })), ...(body.captureGap ? { captureGapRecorded: true } : {}) })
    return Response.json({ id: crypto.randomUUID(), credential: body.bootstrapKey, startedAt: new Date(clock).toISOString(), expiresAt: new Date(clock + 86400000).toISOString(), retentionExpiresAt: new Date(clock + 90 * 86400000).toISOString() })
  })
  return { store, fetcher, advance: (ms: number) => { clock += ms } }
}
describe('durable capture transport', () => {
  it('bounds each signed UTF-8 envelope by both 20 events and 16 KiB', async () => {
    const { store, fetcher } = setup()
    const transport = createAnalyticsTransport(store, 'salon', { fetcher })
    await transport.flush(); fetcher.mockClear()
    store.mutate((state) => { state.streams.find((s) => s.key === state.active)!.receipt!.credential = 's'.repeat(4096) })
    for (let i = 0; i < 45; i++) store.track({ type: 'availability_result', data: { serviceId: 's'.repeat(128), modality: 'on_site', professional: { kind: 'person', professionalId: 'p'.repeat(128) }, localDate: '2026-08-31', queryId: crypto.randomUUID(), requestGeneration: i + 1, result: 'available' } })
    for (let i = 0; i < 5; i++) await transport.flush()
    expect(store.snapshot()?.queue).toEqual([])
    const batches = fetcher.mock.calls.map(([, init]) => JSON.parse(init.body as string))
    expect(batches.length).toBeGreaterThan(2)
    expect(batches.reduce((count, b) => count + b.events.length, 0)).toBe(45)
    for (const [, init] of fetcher.mock.calls) {
      expect(new TextEncoder().encode(init.body as string).length).toBeLessThanOrEqual(16384)
      expect(JSON.parse(init.body as string).events.length).toBeLessThanOrEqual(20)
    }
  })
  it('bootstraps persisted independent keys, then drains parsed events with their signed binding', async () => {
    const { store, fetcher } = setup()
    const transport = createAnalyticsTransport(store, 'salon', { fetcher })
    await transport.flush()
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual(['/api/analytics/salon/session', '/api/analytics/salon/attempt', '/api/analytics/salon/events'])
    expect(store.snapshot()?.queue).toEqual([])
    expect(store.bookingCredential()).toEqual({ credential: store.snapshot()?.active, selectionRevision: 1 })
  })
  it('preserves the old signed binding and revision after completion and a new attempt', async () => {
    const { store, fetcher } = setup()
    const transport = createAnalyticsTransport(store, 'salon', { fetcher })
    await transport.flush()
    const old = store.snapshot()!.active!
    store.changeSelection({ reason: 'time', context: null, localDate: null })
    store.track({ type: 'booking_submit_result', data: { result: 'submitted' } })
    const binding = store.completeAttempt()
    store.startAttempt('complete')
    store.track({ type: 'checkout_redirected', data: { provider: 'mercado_pago' } }, binding)
    await transport.flush()
    const batches = fetcher.mock.calls.map(([, init]) => JSON.parse(init.body as string)).filter((b) => b.events)
    const trailing = batches.find((b) => b.events.some((e: { type: string }) => e.type === 'checkout_redirected'))
    expect(trailing.credential).toBe(old)
    expect(trailing.events.map((e: { type: string }) => e.type)).toEqual(['selection_context_changed', 'booking_submit_result', 'checkout_redirected'])
    expect(trailing.events.at(-1).selectionRevision).toBe(2)
  })
  it('retries a lost bootstrap response with the same key; bounded backoff survives reload state', async () => {
    const { store, fetcher, advance } = setup()
    fetcher.mockRejectedValueOnce(new Error('lost after commit'))
    const transport = createAnalyticsTransport(store, 'salon', { fetcher })
    await transport.flush(); await transport.flush()
    expect(fetcher).toHaveBeenCalledTimes(1)
    advance(5000); await transport.flush()
    expect(JSON.parse(fetcher.mock.calls[0][1].body as string).bootstrapKey).toBe(JSON.parse(fetcher.mock.calls[1][1].body as string).bootstrapKey)
    expect(store.snapshot()?.queue).toEqual([])
  })
  it('partial receipts keep only unacknowledged payloads and retry the same identity', async () => {
    const { store, fetcher, advance } = setup()
    const transport = createAnalyticsTransport(store, 'salon', { fetcher })
    await transport.flush()
    store.track({ type: 'step_viewed', data: { step: 'service' } })
    store.track({ type: 'service_considered', data: { serviceId: 'a' } })
    const [a, b] = store.snapshot()!.queue
    fetcher.mockResolvedValueOnce(Response.json({ receipts: [{ index: 0, eventId: a.event.eventId, status: 'replay', category: 'identical' }] }))
    await transport.flush()
    expect(store.snapshot()?.queue.map((q) => q.event.eventId)).toEqual([b.event.eventId])
    advance(5000); await transport.flush()
    expect(store.snapshot()?.queue).toEqual([])
  })
  it('gap-only control is sent after expiry without retaining rejected payload or losing the booking credential', async () => {
    const { store, fetcher, advance } = setup()
    const transport = createAnalyticsTransport(store, 'salon', { fetcher })
    await transport.flush()
    const credential = store.bookingCredential()!.credential
    store.track({ type: 'step_viewed', data: { step: 'payment' } })
    advance(300001); await transport.flush()
    expect(JSON.parse(fetcher.mock.calls.at(-1)![1].body as string)).toEqual({ credential, events: [], captureGap: true })
    expect(store.bookingCredential()).toEqual({ credential })
    expect(store.snapshot()?.queue).toEqual([])
  })
  it('withdrawal during bootstrap prevents a late response from restoring state', async () => {
    const { store, fetcher } = setup()
    let resolve!: (res: Response) => void
    fetcher.mockImplementationOnce(() => new Promise((r) => { resolve = r }))
    const transport = createAnalyticsTransport(store, 'salon', { fetcher })
    const pending = transport.flush()
    store.withdrawConsent(); transport.stop()
    resolve(Response.json({ id: crypto.randomUUID(), credential: 'late', startedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 86400000).toISOString(), retentionExpiresAt: new Date(Date.now() + 90 * 86400000).toISOString() }))
    await pending
    expect(store.snapshot()).toBeNull(); expect(store.bookingCredential()).toBeUndefined()
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it('stopping a writer alone also prevents a late bootstrap from changing retained state', async () => {
    const { store, fetcher } = setup()
    let resolve!: (res: Response) => void
    fetcher.mockImplementationOnce(() => new Promise((r) => { resolve = r }))
    const transport = createAnalyticsTransport(store, 'salon', { fetcher })
    const before = store.snapshot()
    const pending = transport.flush(); transport.stop()
    resolve(Response.json({ id: crypto.randomUUID(), credential: 'late', startedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 86400000).toISOString(), retentionExpiresAt: new Date(Date.now() + 90 * 86400000).toISOString() }))
    await pending
    expect(store.snapshot()).toEqual(before)
  })
  it('exhausts exactly two transient retries then reports a gap without reusing sequences', async () => {
    const { store, fetcher, advance } = setup()
    const transport = createAnalyticsTransport(store, 'salon', { fetcher })
    await transport.flush()
    store.track({ type: 'step_viewed', data: { step: 'time' } })
    fetcher.mockRejectedValueOnce(new Error('offline')).mockRejectedValueOnce(new Error('offline')).mockRejectedValueOnce(new Error('offline'))
    await transport.flush(); advance(5000); await transport.flush(); advance(5000); await transport.flush()
    expect(store.snapshot()?.queue).toEqual([])
    expect(store.bookingCredential()).not.toHaveProperty('selectionRevision')
    store.track({ type: 'step_viewed', data: { step: 'payment' } })
    expect(store.snapshot()?.queue[0].event.sequence).toBe(3)
  })
})
