import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Service } from '@prisma/client'
import { getVocabulary } from '@/lib/vocabulary'
import { createAnalyticsStore, type AnalyticsStore } from '@/lib/analytics/client-store'
import type { FunnelProfessional } from '@/lib/professionals/eligible'
import { clickButton } from '../helpers/react-dom'
import { reduceFunnelAttempt } from '@/lib/analytics/funnel'
import { attempt, booking, now } from '../helpers/analytics-fixtures'

let store: AnalyticsStore
let captureReady = true
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('next/dynamic', () => ({ default: () => () => <p>Payment boundary</p> }))
vi.mock('@/components/analytics/public-analytics', () => ({ usePublicAnalytics: () => ({ ready: captureReady, track: store.track, startAttempt: store.startAttempt, changeSelection: store.changeSelection, revision: () => store.snapshot()?.revision ?? 1, attemptIdentity: () => store.snapshot()?.active ?? null, rememberSelection: store.rememberSelection, reconcileSelection: (s: string) => store.reconcileSelection(s) }) }))
vi.mock('@/components/booking/step-date', () => ({ StepDate: ({ onSelect, onBack }: { onSelect: (date: Date) => void; onBack: () => void }) => <><button onClick={() => onSelect(new Date('2026-08-31T12:00:00Z'))}>Fecha fixture</button><button onClick={onBack}>Atrás</button></> }))
vi.mock('@/components/booking/step-time', () => ({ StepTime: ({ onSelect, onBack }: { onSelect: (slot: { start: Date; end: Date }) => void; onBack: () => void }) => <><button onClick={() => onSelect({ start: new Date('2026-08-31T14:00:00Z'), end: new Date('2026-08-31T14:30:00Z') })}>Hora fixture</button><button onClick={onBack}>Atrás</button></> }))
vi.mock('@/components/booking/step-customer', () => ({ StepCustomer: ({ onSubmit, onBack, onLoginCta }: { onSubmit: (data: object) => void; onBack: () => void; onLoginCta: (data: object) => void }) => <><button onClick={() => onSubmit({ customerName: 'Private name', customerPhone: 'private phone' })}>Datos fixture</button><button onClick={() => onLoginCta({ customerName: 'Private login name' })}>Login fixture</button><button onClick={onBack}>Atrás</button></> }))
import { BookingWizard } from '@/components/booking/wizard'
const service = (id: string, modalities = ['on_site']): Service => ({ id, name: id, isActive: true, price: 1000, depositAmount: 0, durationMinutes: 30, pastelColor: '#fff', modalities } as Service)
let root: Root
let host: HTMLDivElement
beforeEach(() => {
  captureReady = true
  const values = new Map<string, string>()
  const storage = { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => { values.set(k, v) }, removeItem: (k: string) => { values.delete(k) } }
  vi.stubGlobal('sessionStorage', storage)
  store = createAnalyticsStore({ businessId: 'salon', origin: 'https://test.local', storage, preferences: storage })
  store.chooseConsent(true); store.open()
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); document.body.replaceChildren(); window.history.replaceState({}, '', '/'); vi.unstubAllGlobals() })
function render(services: Service[], professionals: FunnelProfessional[] = []) {
  act(() => root.render(<BookingWizard businessId="salon" slug="salon" business={{ name: 'salon', addressText: null, whatsapp: null }} timezone="America/Santiago" currency="CLP" services={services} professionals={professionals} professionalWords={getVocabulary('barber')} session={null} cancellationPolicyRevision="v1" selfServiceCutoffHours={24} manualHoldHours={24} />))
}
describe('wizard evidence follows actual interactions', () => {
  it('reconsent observes the same visible step for its new partial attempt even at revision one', async () => {
    captureReady = false; store.withdrawConsent()
    const services = [service('Corte', ['on_site', 'at_home'])]
    render(services); await clickButton(host, 'Corte', { match: 'contains' })
    store.chooseConsent(true); store.open(); captureReady = true; render(services)
    const first = store.snapshot()!
    expect(first.queue.map((q) => q.event.type)).toEqual(['step_viewed'])
    captureReady = false; store.withdrawConsent(); render(services)
    store.chooseConsent(true); store.open(); captureReady = true; render(services)
    expect(store.snapshot()?.active).not.toBe(first.active)
    expect(store.snapshot()?.revision).toBe(1)
    expect(store.snapshot()?.queue.map((q) => q.event.type)).toEqual(['step_viewed'])
  })
  it('opt-in after opening a multimodal card is partial and never reconstructs pre-consent interest', async () => {
    captureReady = false; store.withdrawConsent()
    const services = [service('Corte', ['on_site', 'at_home'])]
    render(services)
    await clickButton(host, 'Corte', { match: 'contains' })
    expect(host.textContent).toContain('¿Dónde te lo hacemos?')
    expect(store.snapshot()).toBeNull()
    store.chooseConsent(true); store.open(); captureReady = true
    render(services)
    const state = store.snapshot()!
    expect(state.streams.find((s) => s.key === state.active)?.entryKind).toBe('partial')
    expect(state.queue.map((q) => q.event.type)).toEqual(['step_viewed'])
    await clickButton(host, 'En el local')
    expect(store.snapshot()?.queue.some((q) => q.event.type === 'service_selected')).toBe(true)
    expect(store.snapshot()?.queue.some((q) => q.event.type === 'service_considered')).toBe(false)
  })
  it('records anyone explicitly only when the actual optional professional step is displayed', async () => {
    render([service('Corte')], ['one', 'two'].map((id) => ({ id, name: id, bio: null, modalities: ['on_site'], serviceIds: ['Corte'] })))
    await clickButton(host, 'Corte', { match: 'contains' })
    await clickButton(host, 'Cualquiera disponible', { match: 'contains' })
    const events = store.snapshot()!.queue.map((q) => q.event)
    expect(events.find((e) => e.type === 'service_selected')?.data).toMatchObject({ professionalStepRequired: true })
    expect(events.find((e) => e.type === 'professional_selected')?.data).toMatchObject({ professional: { kind: 'anyone' } })
    expect(events.filter((e) => e.type === 'step_viewed').map((e) => e.data.step)).toContain('professional')
  })
  it('restores valid selection after login without reconstructing explicit interactions or a new full attempt', async () => {
    render([service('Corte')])
    await clickButton(host, 'Corte', { match: 'contains' }); await clickButton(host, 'Fecha fixture'); await clickButton(host, 'Hora fixture')
    const before = store.snapshot()!
    await clickButton(host, 'Login fixture')
    act(() => root.unmount()); root = createRoot(host)
    window.history.replaceState({}, '', '/?continuar=1')
    render([service('Corte')])
    expect(host.textContent).toContain('Datos fixture')
    expect(store.snapshot()?.active).toBe(before.active)
    expect(store.snapshot()?.revision).toBe(before.revision)
    expect(store.snapshot()?.queue.filter((q) => q.event.type === 'funnel_started').length).toBe(1)
    expect(store.snapshot()?.queue.filter((q) => q.event.type === 'time_selected').length).toBe(1)
    expect(JSON.stringify(store.snapshot())).not.toContain('Private login name')
  })
  it('a restored booking with lost analytics identity starts partial without invented selection evidence', async () => {
    render([service('Corte')])
    await clickButton(host, 'Corte', { match: 'contains' }); await clickButton(host, 'Fecha fixture'); await clickButton(host, 'Hora fixture'); await clickButton(host, 'Login fixture')
    act(() => root.unmount()); root = createRoot(host)
    store.discardState(); store.open()
    window.history.replaceState({}, '', '/?continuar=1')
    render([service('Corte')])
    expect(host.textContent).toContain('Datos fixture')
    const state = store.snapshot()!
    expect(state.streams.find((s) => s.key === state.active)?.entryKind).toBe('partial')
    expect(state.queue.map((q) => q.event.type)).toEqual(['step_viewed'])
  })
  it('opening a multimodal service records consideration only; selecting a modality resolves selection', async () => {
    render([service('Corte', ['on_site', 'at_home'])])
    await clickButton(host, 'Corte', { match: 'contains' })
    expect(store.snapshot()?.queue.some((q) => q.event.type === 'service_considered')).toBe(true)
    expect(store.snapshot()?.queue.some((q) => q.event.type === 'service_selected')).toBe(false)
    await clickButton(host, 'En el local')
    expect(store.snapshot()?.queue.find((q) => q.event.type === 'service_selected')?.event.data).toMatchObject({ serviceId: 'Corte', modality: 'on_site', professionalStepRequired: false })
  })
  it('A time then B selection invalidates downstream evidence and never includes customer fields', async () => {
    render([service('Corte'), service('Masaje')])
    await clickButton(host, 'Corte', { match: 'contains' }); await clickButton(host, 'Fecha fixture'); await clickButton(host, 'Hora fixture')
    await clickButton(host, 'Atrás'); await clickButton(host, 'Atrás'); await clickButton(host, 'Atrás')
    await clickButton(host, 'Masaje', { match: 'contains' })
    await clickButton(host, 'Fecha fixture'); await clickButton(host, 'Hora fixture'); await clickButton(host, 'Datos fixture')
    const events = store.snapshot()!.queue.map((q) => q.event)
    expect(events.filter((e) => e.type === 'selection_context_changed').at(-1)?.data).toMatchObject({ reason: 'service', context: { serviceId: 'Masaje' } })
    expect(events.filter((e) => e.type === 'time_selected').at(-1)?.data).toMatchObject({ serviceId: 'Masaje' })
    expect(events.some((e) => e.type === 'customer_step_completed')).toBe(true)
    expect(JSON.stringify(events)).not.toMatch(/Private name|private phone|customerName|customerPhone/)
    // Lose only B's explicit time evidence; Booking remains authoritative, A's time is not stitched.
    const lost = events.filter((e) => e.type !== 'time_selected' || e.data.serviceId !== 'Masaje')
    const revision = store.snapshot()!.revision
    const lastSequence = events.at(-1)!.sequence
    const observed = [...lost, { version: 1 as const, eventId: crypto.randomUUID(), sequence: lastSequence + 1, selectionRevision: revision, type: 'booking_submit_result' as const, data: { result: 'submitted' as const } }].map((event) => ({ event, receivedAt: attempt().startedAt }))
    expect(reduceFunnelAttempt({ attempt: attempt(), events: observed, bookings: [{ ...booking('b', 'attempt-1', 'Masaje'), analyticsSelectionRevision: revision }], now })).toMatchObject({ converted: true, conversionPathComplete: false, quality: 'incomplete' })
  })
})
