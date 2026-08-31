import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import type { BookingData } from '@/components/booking/wizard'
import { createAnalyticsStore } from '@/lib/analytics/client-store'
import { reduceFunnelAttempt } from '@/lib/analytics/funnel'
import { attempt, now } from '../helpers/analytics-fixtures'

const getAvailableTimeSlotsResult = vi.hoisted(() => vi.fn())
const capture = vi.hoisted(() => ({ ready: false, revision: vi.fn(() => 1), attemptIdentity: vi.fn(() => 'fixture'), track: vi.fn(), nextAvailabilityGeneration: vi.fn((): number | null => 1) }))
vi.mock('@/server/actions/availability', () => ({ getAvailableTimeSlotsResult }))
vi.mock('@/components/analytics/public-analytics', () => ({ usePublicAnalytics: () => capture }))

const { StepTime } = await import('@/components/booking/step-time')

const base = {
  serviceId: 'svc-1', serviceName: 'Corte', professional: { kind: 'none' }, professionalName: '',
  serviceModality: 'on_site',
  date: new Date('2026-06-15T15:00:00Z'), timeSlot: null,
} as unknown as BookingData

describe('los horarios que pide el paso de la hora', () => {
  let root: Root | null = null
  let container: HTMLDivElement

  beforeEach(() => {
    capture.ready = false; capture.revision.mockReset().mockReturnValue(1); capture.track.mockReset()
    capture.nextAvailabilityGeneration.mockReset().mockReturnValue(1)
    capture.attemptIdentity.mockReset().mockReturnValue('fixture')
    getAvailableTimeSlotsResult.mockReset()
    getAvailableTimeSlotsResult.mockResolvedValue({ ok: true, data: { slots: [], emptyReason: null } })
  })

  afterEach(() => {
    if (root) {
      act(() => root?.unmount())
      root = null
    }
    document.body.replaceChildren()
  })

  async function montar(data: BookingData) {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => {
      root?.render(<StepTime businessId="biz-1" timezone="America/Santiago" data={data} onSelect={() => {}} onBack={() => {}} />)
    })
  }

  it('a remounted same-date query remains observable through the real funnel reducer', async () => {
    const values = new Map<string, string>()
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) }, removeItem: (key: string) => { values.delete(key) } }
    const options = { businessId: 'biz-1', origin: 'https://example.test', storage, preferences: storage }
    let store = createAnalyticsStore(options)
    store.chooseConsent(true); store.open(); store.startAttempt('complete')
    const context = { serviceId: 'svc-1', modality: 'on_site' as const, professional: { kind: 'none' as const } }
    store.track({ type: 'service_selected', data: { ...context, professionalStepRequired: false } })
    store.track({ type: 'date_selected', data: { ...context, localDate: '2026-06-15' } })
    capture.ready = true
    capture.track.mockImplementation((event) => store.track(event))
    capture.attemptIdentity.mockImplementation(() => store.snapshot()!.active!)
    capture.nextAvailabilityGeneration.mockImplementation(() => store.nextAvailabilityGeneration()!)
    getAvailableTimeSlotsResult.mockResolvedValueOnce({ ok: true, data: { slots: [{ start: new Date('2026-06-15T18:00:00Z'), end: new Date('2026-06-15T18:30:00Z') }], emptyReason: null } })
    await montar(base)
    act(() => root!.unmount()); root = null
    // Restore durable capture state as well as remounting the time step.
    store = createAnalyticsStore(options); store.open()
    getAvailableTimeSlotsResult.mockResolvedValueOnce({ ok: true, data: { slots: [], emptyReason: 'no_capacity' } })
    await montar(base)
    const state = store.snapshot()!
    const result = reduceFunnelAttempt({ attempt: attempt(), events: state.queue.map((item) => ({ event: item.event, receivedAt: attempt().startedAt })), bookings: [], now })
    expect(result.availability).toMatchObject({ hasValidResult: true, hasEmpty: true, emptyReasons: ['no_capacity'] })
    expect(state.queue.flatMap(({ event }) => event.type === 'availability_result' ? [event.data.requestGeneration] : [])).toEqual([1, 2])
  })
  it('failed capture generation persistence cannot leave available booking data loading forever', async () => {
    capture.ready = true; capture.revision.mockReturnValue(2)
    capture.nextAvailabilityGeneration.mockImplementation(() => {
      // Store's write-failure boundary discards capture state, not the Booking request.
      capture.revision.mockReturnValue(1); capture.attemptIdentity.mockReturnValue('')
      return null
    })
    await montar(base)
    expect(container.textContent).toContain('No hay horarios disponibles')
    expect(container.textContent).not.toContain('Cargando')
    expect(capture.track).not.toHaveBeenCalled()
  })

  /**
   * Es el punto de la feature: con persona los horarios salen de SU agenda. Si este
   * argumento vuelve a ser `null`, la pantalla ofrece las horas del negocio y la
   * reserva se cae recién al pagar, contra el horario de verdad.
   */
  it('los pide a nombre de la persona elegida', async () => {
    await montar({ ...base, professional: { kind: 'person', id: 'p-1' }, professionalName: 'Juan' })
    expect(getAvailableTimeSlotsResult).toHaveBeenCalledWith({
      businessId: 'biz-1', serviceId: 'svc-1', date: base.date,
      professional: { kind: 'person', id: 'p-1' }, modality: 'on_site',
    })
  })

  it('sin persona, los del negocio', async () => {
    await montar(base)
    expect(getAvailableTimeSlotsResult).toHaveBeenCalledWith({
      businessId: 'biz-1', serviceId: 'svc-1', date: base.date,
      professional: { kind: 'none' }, modality: 'on_site',
    })
  })

  /**
   * La modalidad viaja porque el servidor la necesita para saber QUIÉN es elegible
   * cuando la respuesta es "cualquiera": sin ella, la unión incluiría los horarios de
   * quien no viaja a domicilio y la reserva se caería recién al pagar.
   */
  it('con "cualquiera" manda la elección y la modalidad', async () => {
    await montar({ ...base, professional: { kind: 'anyone' }, serviceModality: 'at_home' } as BookingData)
    expect(getAvailableTimeSlotsResult).toHaveBeenCalledWith({
      businessId: 'biz-1', serviceId: 'svc-1', date: base.date,
      professional: { kind: 'anyone' }, modality: 'at_home',
    })
  })

  it('nombra a la persona junto al servicio y la fecha', async () => {
    getAvailableTimeSlotsResult.mockResolvedValue({ ok: true, data: { slots: [{ start: new Date('2026-06-15T18:00:00Z'), end: new Date('2026-06-15T18:30:00Z') }], emptyReason: null } })
    await montar({ ...base, professional: { kind: 'person', id: 'p-1' }, professionalName: 'Juan' })
    expect(container.textContent).toContain('Corte · Juan')
  })
  it('a late previous request cannot overwrite the current professional slots', async () => {
    let first!: (value: unknown) => void
    let second!: (value: unknown) => void
    getAvailableTimeSlotsResult.mockImplementationOnce(() => new Promise((resolve) => { first = resolve }))
      .mockImplementationOnce(() => new Promise((resolve) => { second = resolve }))
    await montar(base)
    await act(async () => root!.render(<StepTime businessId="biz-1" timezone="America/Santiago" data={{ ...base, professional: { kind: 'anyone' } }} onSelect={() => {}} onBack={() => {}} />))
    await act(async () => second({ ok: true, data: { slots: [{ start: new Date('2026-06-15T19:00:00Z'), end: new Date('2026-06-15T19:30:00Z') }], emptyReason: null } }))
    await act(async () => first({ ok: true, data: { slots: [], emptyReason: null } }))
    expect(container.textContent).toContain('15:00')
    expect(container.textContent).not.toContain('No hay horarios disponibles')
  })
  it('restarts a pending query when consent or restore changes its capture revision', async () => {
    let first!: (value: unknown) => void
    getAvailableTimeSlotsResult.mockImplementationOnce(() => new Promise((resolve) => { first = resolve }))
    await montar(base)
    capture.ready = true; capture.revision.mockReturnValue(2)
    await act(async () => root!.render(<StepTime businessId="biz-1" timezone="America/Santiago" data={base} onSelect={() => {}} onBack={() => {}} />))
    await act(async () => first({ ok: true, data: { slots: [{ start: new Date('2026-06-15T19:00:00Z'), end: new Date('2026-06-15T19:30:00Z') }], emptyReason: null } }))
    expect(getAvailableTimeSlotsResult).toHaveBeenCalledTimes(2)
    expect(container.textContent).toContain('No hay horarios disponibles')
    expect(container.textContent).not.toContain('Cargando')
    expect(capture.track).toHaveBeenCalledTimes(1)
  })
})
