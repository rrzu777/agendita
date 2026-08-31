import { act, useEffect, useLayoutEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PublicAnalytics, usePublicAnalytics } from '@/components/analytics/public-analytics'
import { BookingWizard } from '@/components/booking/wizard'
import { getVocabulary } from '@/lib/vocabulary'
import type { Service } from '@prisma/client'
import { analyticsStorageKeys } from '@/lib/analytics/client-store'
import type { BookingData } from '@/components/booking/wizard'
import { clickButton } from '../helpers/react-dom'
const createBooking = vi.hoisted(() => vi.fn())
const slots = vi.hoisted(() => vi.fn())
vi.mock('@/server/actions/bookings', () => ({ createBooking }))
vi.mock('@/server/actions/promotions', () => ({ previewPromotion: vi.fn() }))
vi.mock('@/server/actions/payments', () => ({ getOnlinePaymentAvailability: vi.fn().mockResolvedValue({ available: true, provider: 'mercado_pago', isMock: false }), initiatePayment: vi.fn().mockResolvedValue({ ok: false, error: 'Checkout fixture failed' }), verifyAndConfirmPayment: vi.fn() }))
vi.mock('@/server/actions/bank-transfer-public', () => ({ getBankTransferInfo: vi.fn().mockResolvedValue(null), declareBankTransfer: vi.fn(), createProofUploadUrl: vi.fn() }))
vi.mock('@/server/actions/packages', () => ({ getActivePackagesForCustomer: vi.fn().mockResolvedValue({ ok: true, data: { remaining: 0 } }) }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('next/dynamic', () => ({ default: () => () => null }))
vi.mock('@/server/actions/availability', () => ({ getAvailableTimeSlotsResult: slots }))

let root: Root | undefined
beforeEach(() => {
  // Explicit browser boundary: Node 26's global localStorage is not JSDOM storage.
  for (const name of ['localStorage', 'sessionStorage']) {
    const values = new Map<string, string>()
    vi.stubGlobal(name, { get length() { return values.size }, getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => { values.set(k, v) }, removeItem: (k: string) => values.delete(k), clear: () => values.clear() })
  }
})
afterEach(() => { act(() => root?.unmount()); document.body.replaceChildren(); window.localStorage.clear(); window.sessionStorage.clear(); vi.restoreAllMocks(); Reflect.deleteProperty(navigator, 'locks'); vi.unstubAllGlobals() })
function BookingProbe() {
  const analytics = usePublicAnalytics()
  useEffect(() => { analytics.startAttempt('complete') }, [analytics])
  return <button onClick={() => analytics.track({ type: 'booking_submit_result', data: { result: 'submitted' } })}>Reservar</button>
}
function RevisionProbe() {
  const analytics = usePublicAnalytics()
  return <button onClick={() => { analytics.startAttempt('partial'); analytics.changeSelection({ reason: 'restore', context: null, localDate: null }) }}>Revisión {analytics.revision()}</button>
}
function NewSelectionProbe() {
  const analytics = usePublicAnalytics()
  return <><button onClick={() => analytics.changeSelection({ reason: 'time', context: { serviceId: 'svc', modality: 'on_site', professional: { kind: 'none' } }, localDate: '2026-08-31' })}>Nueva hora explícita</button><button onClick={() => { const binding = analytics.completeAttempt(); if (binding) analytics.track({ type: 'checkout_redirected', data: { provider: 'mercado_pago' } }, binding) }}>Salida checkout posterior</button></>
}
function EarlyConsentProbe({ onAttempt }: { onAttempt: (disabled: boolean) => void }) {
  useLayoutEffect(() => {
    const consent = Array.from(document.querySelectorAll('button')).find((button) => button.textContent === 'Permitir métricas')!
    onAttempt(consent.disabled)
    consent.click()
  }, [onAttempt])
  return null
}
describe('public opt-in boundary', () => {
  it('keeps consent controls inert until their browser store is initialized', async () => {
    let disabledBeforeProviderEffect = false
    const host = document.createElement('div'); document.body.append(host); root = createRoot(host)
    await act(async () => root!.render(<PublicAnalytics businessId="salon" slug="salon" timezone="UTC" eligible surface="booking"><EarlyConsentProbe onAttempt={(disabled) => { disabledBeforeProviderEffect = disabled }} /></PublicAnalytics>))
    const preference = analyticsStorageKeys('salon', window.location.origin).preference
    expect(disabledBeforeProviderEffect).toBe(true)
    expect(window.localStorage.getItem(preference)).toBeNull()
    await clickButton(host, 'Permitir métricas')
    expect(JSON.parse(window.localStorage.getItem(preference)!)).toMatchObject({ allowed: true })
  })
  it('availability observes a newly started attempt even when its revision stays one', async () => {
    const { StepTime } = await import('@/components/booking/step-time')
    slots.mockResolvedValue({ ok: true, data: { slots: [], emptyReason: 'no_capacity' } })
    Object.defineProperty(navigator, 'locks', { configurable: true, value: { request: async (_name: string, _options: unknown, callback: (lock: object) => Promise<void>) => callback({}) } })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 503 })))
    const data = { serviceId: 'svc', serviceModality: 'on_site', professional: { kind: 'none' }, date: new Date('2026-08-31T12:00:00Z') } as BookingData
    const host = document.createElement('div'); document.body.append(host); root = createRoot(host)
    await act(async () => root!.render(<PublicAnalytics businessId="salon" slug="salon" timezone="UTC" eligible surface="booking"><StepTime data={data} businessId="salon" timezone="UTC" onSelect={vi.fn()} onBack={vi.fn()} /><BookingProbe /></PublicAnalytics>))
    await clickButton(host, 'Permitir métricas')
    const state = JSON.parse(window.sessionStorage.getItem(analyticsStorageKeys('salon', window.location.origin).state)!)
    expect(state.queue.filter((item: { event: { type: string } }) => item.event.type === 'availability_result')).toHaveLength(1)
  })
  it('reconsent at payment bootstraps a new evidenced attempt and keeps its credential on Booking', async () => {
    const { StepPayment } = await import('@/components/booking/step-payment')
    Object.defineProperty(navigator, 'locks', { configurable: true, value: { request: async (_name: string, _options: unknown, callback: (lock: object) => Promise<void>) => callback({}) } })
    const batches: { credential: string; events: { type: string }[] }[] = []
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string)
      if (body.events) {
        batches.push(body)
        return Response.json({ receipts: body.events.map((event: { eventId: string }, index: number) => ({ index, eventId: event.eventId, status: 'accepted', category: 'stored' })) })
      }
      return Response.json({ id: crypto.randomUUID(), credential: body.bootstrapKey, startedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 86400000).toISOString(), retentionExpiresAt: new Date(Date.now() + 90 * 86400000).toISOString() })
    }))
    createBooking.mockResolvedValue({ ok: true, data: { id: 'reconsented-booking', status: 'confirmed', modality: 'on_site', professional: null } })
    const data = { serviceId: 'svc', serviceName: 'Corte', servicePrice: 1000, serviceDeposit: 0, serviceDuration: 30, serviceModality: 'on_site', professional: { kind: 'none' }, date: new Date('2026-08-31T12:00:00Z'), timeSlot: { start: new Date('2026-08-31T14:00:00Z'), end: new Date('2026-08-31T14:30:00Z') }, customerName: 'Synthetic', customerPhone: '+56900000000', customerEmail: 'synthetic@example.test' } as BookingData
    const host = document.createElement('div'); document.body.append(host); root = createRoot(host)
    await act(async () => root!.render(<PublicAnalytics businessId="salon" slug="salon" timezone="UTC" eligible surface="booking"><StepPayment data={data} updateData={vi.fn()} businessId="salon" timezone="UTC" currency="CLP" cancellationPolicyRevision="v1" selfServiceCutoffHours={24} manualHoldHours={24} onSuccess={vi.fn()} onBack={vi.fn()} /></PublicAnalytics>))
    const read = () => JSON.parse(window.sessionStorage.getItem(analyticsStorageKeys('salon', window.location.origin).state)!)
    await clickButton(host, 'Permitir métricas')
    const first = read().active
    expect(batches.some((batch) => batch.credential === first && batch.events.some((event) => event.type === 'payment_branch_viewed'))).toBe(true)
    await clickButton(host, 'Retirar permiso de métricas')
    expect(read()).toBeNull()
    await clickButton(host, 'Cambiar preferencia de métricas')
    await clickButton(host, 'Permitir métricas')
    const state = read(), second = state.active
    expect(second).not.toBe(first)
    expect(batches.some((batch) => batch.credential === second && batch.events.some((event) => event.type === 'payment_branch_viewed'))).toBe(true)
    expect(state.streams.find((stream: { key: string }) => stream.key === second)).toMatchObject({ entryKind: 'partial', receipt: { credential: second } })
    expect(host.querySelector<HTMLInputElement>('#accept-terms')!.checked).toBe(false)
    await act(async () => host.querySelector<HTMLInputElement>('#accept-terms')!.click())
    await clickButton(host, 'Confirmar reserva', { match: 'contains' })
    expect(createBooking.mock.calls.at(-1)![0].analytics).toEqual({ credential: second, selectionRevision: 1 })
  })
  it('checkout retry and visibility cannot reopen a completed attempt; an explicit new selection can', async () => {
    const { StepPayment } = await import('@/components/booking/step-payment')
    Object.defineProperty(navigator, 'locks', { configurable: true, value: { request: async (_name: string, _options: unknown, callback: (lock: object) => Promise<void>) => callback({}) } })
    let captureOffline = false
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string)
      if (captureOffline) return new Response(null, { status: 503 })
      if (body.events) return Response.json({ receipts: body.events.map((e: { eventId: string }, index: number) => ({ index, eventId: e.eventId, status: 'accepted', category: 'stored' })) })
      return Response.json({ id: crypto.randomUUID(), credential: body.bootstrapKey, startedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 86400000).toISOString(), retentionExpiresAt: new Date(Date.now() + 90 * 86400000).toISOString() })
    }))
    createBooking.mockResolvedValue({ ok: true, data: { id: 'booking', status: 'pending_payment', modality: 'on_site', professional: null } })
    const data = { serviceId: 'svc', serviceName: 'Corte', servicePrice: 1000, serviceDeposit: 500, serviceDuration: 30, serviceModality: 'on_site', professional: { kind: 'none' }, date: new Date('2026-08-31T12:00:00Z'), timeSlot: { start: new Date('2026-08-31T14:00:00Z'), end: new Date('2026-08-31T14:30:00Z') }, customerName: 'Synthetic', customerPhone: '+56900000000', customerEmail: 'synthetic@example.test' } as BookingData
    const host = document.createElement('div'); document.body.append(host); root = createRoot(host)
    await act(async () => root!.render(<PublicAnalytics businessId="salon" slug="salon" timezone="UTC" eligible surface="booking"><NewSelectionProbe /><StepPayment data={data} updateData={vi.fn()} businessId="salon" timezone="UTC" currency="CLP" cancellationPolicyRevision="v1" selfServiceCutoffHours={24} manualHoldHours={24} onSuccess={vi.fn()} onBack={vi.fn()} /></PublicAnalytics>))
    await clickButton(host, 'Permitir métricas')
    const read = () => JSON.parse(window.sessionStorage.getItem(analyticsStorageKeys('salon', window.location.origin).state)!)
    const original = read().active
    captureOffline = true
    await act(async () => host.querySelector<HTMLInputElement>('#accept-terms')!.click())
    await clickButton(host, 'Pagar abono', { match: 'contains' })
    expect(host.textContent).toContain('Checkout fixture failed')
    expect(read().active).toBeNull()
    await clickButton(host, 'Intentar de nuevo')
    await act(async () => document.dispatchEvent(new Event('visibilitychange')))
    expect(read().active).toBeNull()
    await clickButton(host, 'Salida checkout posterior')
    expect(read().queue.some((q: { stream: string; event: { type: string } }) => q.stream === original && q.event.type === 'checkout_redirected')).toBe(true)
    await clickButton(host, 'Nueva hora explícita')
    const state = read()
    expect(state.active).not.toBe(original)
    expect(state.streams.find((s: { key: string }) => s.key === state.active)).toMatchObject({ entryKind: 'partial' })
    expect(state.streams.find((s: { key: string }) => s.key === original)).toMatchObject({ completed: true })
    expect(state.queue.some((q: { stream: string; event: { type: string } }) => q.stream === original && q.event.type === 'booking_submit_result')).toBe(true)
  })
  it('publishes selection revision transitions to consumers without unrelated booking changes', async () => {
    Object.defineProperty(navigator, 'locks', { configurable: true, value: { request: async (_name: string, _options: unknown, callback: (lock: object) => Promise<void>) => callback({}) } })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({})))
    const host = document.createElement('div'); document.body.append(host); root = createRoot(host)
    await act(async () => root!.render(<PublicAnalytics businessId="salon" slug="salon" timezone="UTC" eligible surface="booking"><RevisionProbe /></PublicAnalytics>))
    await act(async () => Array.from(host.querySelectorAll('button')).find((b) => b.textContent === 'Permitir métricas')!.click())
    await act(async () => Array.from(host.querySelectorAll('button')).find((b) => b.textContent === 'Revisión 1')!.click())
    expect(host.textContent).toContain('Revisión 2')
  })
  it('an already consented but hidden mount creates no collector session until visible', async () => {
    Object.defineProperty(navigator, 'locks', { configurable: true, value: { request: async (_name: string, _options: unknown, callback: (lock: object) => Promise<void>) => callback({}) } })
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    const key = analyticsStorageKeys('salon', window.location.origin).preference
    window.localStorage.setItem(key, JSON.stringify({ version: 1, allowed: true, expiresAt: Date.now() + 86400000 }))
    const requests = vi.fn().mockResolvedValue(Response.json({})); vi.stubGlobal('fetch', requests)
    const host = document.createElement('div'); document.body.append(host); root = createRoot(host)
    await act(async () => root!.render(<PublicAnalytics businessId="salon" slug="salon" timezone="UTC" eligible surface="profile"><BookingProbe /></PublicAnalytics>))
    expect(requests).not.toHaveBeenCalled()
    visibility.mockReturnValue('visible')
    await act(async () => document.dispatchEvent(new Event('visibilitychange')))
    expect(requests).toHaveBeenCalled()
    visibility.mockRestore(); Reflect.deleteProperty(navigator, 'locks')
  })
  it('exposes equivalent choices and functional booking without IDs, bootstrap or queue', async () => {
    const requests = vi.fn()
    vi.stubGlobal('fetch', requests)
    const host = document.createElement('div'); document.body.append(host); root = createRoot(host)
    await act(async () => root!.render(<PublicAnalytics businessId="salon" slug="salon" timezone="America/Santiago" eligible surface="booking"><BookingProbe /><BookingWizard businessId="salon" slug="salon" business={{ name: 'salon', addressText: null, whatsapp: null }} timezone="America/Santiago" currency="CLP" services={[{ id: 'svc', name: 'Servicio disponible', modalities: ['on_site'], price: 1000, depositAmount: 0, durationMinutes: 30 } as Service]} professionals={[]} professionalWords={getVocabulary('barber')} session={null} cancellationPolicyRevision="v1" selfServiceCutoffHours={24} manualHoldHours={24} /></PublicAnalytics>))
    const buttons = Array.from(host.querySelectorAll('button'))
    expect(buttons.map((b) => b.textContent)).toEqual(expect.arrayContaining(['Permitir métricas', 'Continuar sin métricas', 'Reservar']))
    expect(buttons.every((b) => !b.disabled)).toBe(true)
    await act(async () => buttons.find((b) => b.textContent === 'Reservar')!.click())
    expect(requests).not.toHaveBeenCalled()
    expect(window.localStorage.length).toBe(0); expect(window.sessionStorage.length).toBe(0)
    await act(async () => buttons.find((b) => b.textContent === 'Continuar sin métricas')!.click())
    expect(window.sessionStorage.length).toBe(0); expect(requests).not.toHaveBeenCalled()
    expect(host.textContent).toContain('Reservar')
    expect(host.textContent).toContain('Servicio disponible')
  })
  it('fails closed without Web Locks while keeping booking usable after opt-in', async () => {
    const requests = vi.fn(); vi.stubGlobal('fetch', requests)
    const host = document.createElement('div'); document.body.append(host); root = createRoot(host)
    await act(async () => root!.render(<PublicAnalytics businessId="salon" slug="salon" timezone="UTC" eligible surface="booking"><BookingProbe /></PublicAnalytics>))
    await act(async () => Array.from(host.querySelectorAll('button')).find((b) => b.textContent === 'Permitir métricas')!.click())
    expect(requests).not.toHaveBeenCalled(); expect(window.sessionStorage.length).toBe(0)
    expect(host.textContent).toContain('Reservar')
  })
  it('a cloned state can never acquire a second writer; withdrawal clears state and stops capture', async () => {
    const held = new Set<string>()
    Object.defineProperty(navigator, 'locks', { configurable: true, value: { request: async (name: string, _options: unknown, callback: (lock: object | null) => Promise<void>) => {
      if (held.has(name)) return callback(null)
      held.add(name)
      try { await callback({ name }) } finally { held.delete(name) }
    } } })
    const requests = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string)
      if (body.events) return Response.json({ receipts: body.events.map((e: { eventId: string }, index: number) => ({ index, eventId: e.eventId, status: 'accepted', category: 'stored' })) })
      return Response.json({ id: crypto.randomUUID(), credential: body.bootstrapKey, startedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 86400000).toISOString(), retentionExpiresAt: new Date(Date.now() + 90 * 86400000).toISOString() })
    })
    vi.stubGlobal('fetch', requests)
    const host = document.createElement('div'); document.body.append(host); root = createRoot(host)
    const provider = (key: string) => <PublicAnalytics key={key} businessId="salon" slug="salon" timezone="UTC" eligible surface="booking"><BookingProbe /></PublicAnalytics>
    await act(async () => root!.render(provider('original')))
    await act(async () => Array.from(host.querySelectorAll('button')).find((b) => b.textContent === 'Permitir métricas')!.click())
    await act(async () => root!.render(<>{provider('original')}{provider('clone')}</>))
    expect(held.size).toBe(1)
    expect(requests.mock.calls.filter(([url]) => url.endsWith('/session')).length).toBe(1)
    const key = analyticsStorageKeys('salon', window.location.origin).preference
    await act(async () => {
      window.localStorage.setItem(key, JSON.stringify({ version: 1, allowed: false, expiresAt: Date.now() + 86400000 }))
      window.dispatchEvent(new StorageEvent('storage', { key }))
    })
    expect(window.sessionStorage.length).toBe(0)
    const count = requests.mock.calls.length
    await act(async () => host.querySelector('button')!.click())
    expect(requests).toHaveBeenCalledTimes(count)
    Reflect.deleteProperty(navigator, 'locks')
  })
})
