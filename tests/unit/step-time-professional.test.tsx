import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import type { BookingData } from '@/components/booking/wizard'

const getAvailableTimeSlotsResult = vi.hoisted(() => vi.fn())
const capture = vi.hoisted(() => ({ ready: false, revision: vi.fn(() => 1), track: vi.fn() }))
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
    capture.ready = false; capture.revision.mockReset().mockReturnValue(1); capture.track.mockClear()
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
