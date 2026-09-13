import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { StepDateTime } from '@/components/booking/step-date-time'
import type { BookingData } from '@/components/booking/wizard'
const preview = vi.hoisted(() => vi.fn())
vi.mock('@/server/actions/availability', () => ({ getAvailabilityPreview: preview, getAvailableTimeSlotsResult: vi.fn() }))
let root: Root
afterEach(() => { act(() => root?.unmount()); document.body.replaceChildren(); vi.restoreAllMocks() })
describe('combined calendar availability', () => {
  it('never enables a day from an obsolete service preview and converts the chosen local day after DST', async () => {
    let first!: (value: unknown) => void
    let second!: (value: unknown) => void
    preview.mockImplementationOnce(() => new Promise(resolve => { first = resolve })).mockImplementationOnce(() => new Promise(resolve => { second = resolve }))
    const host = document.createElement('div'); document.body.append(host); root = createRoot(host)
    const choose = vi.fn()
    const data = { serviceIds: ['cut'], professional: { kind: 'none' }, serviceModality: 'on_site', date: new Date('2026-09-14T15:00:00Z') } as BookingData
    const render = (ids: string[]) => <StepDateTime businessId="biz" timezone="America/Santiago" data={{ ...data, serviceIds: ids, date: data.date }} onDate={choose} onSelect={vi.fn()} onBack={vi.fn()} />
    await act(async () => root.render(render(['cut'])))
    await act(async () => root.render(render(['cut', 'nose'])))
    const result = (count: number) => ({ ok: true, data: { today: '2026-09-12', windowEnd: '2026-09-30', professionals: [], days: [{ date: '2026-09-15', count, firstSlot: null }] } })
    await act(async () => first(result(10)))
    expect(host.textContent).toContain('Consultando días')
    expect(host.querySelector<HTMLButtonElement>('[data-day="2026-09-15"]')!.disabled).toBe(true)
    await act(async () => second(result(2)))
    const day = host.querySelector<HTMLButtonElement>('[data-day="2026-09-15"]')!
    expect(day.getAttribute('aria-label')).toContain('2 horarios')
    expect(host.querySelector<HTMLButtonElement>('[data-day="2026-09-16"]')!.disabled).toBe(true)
    act(() => day.click())
    expect(choose).toHaveBeenCalledWith(new Date('2026-09-15T15:00:00Z'))
    expect(host.querySelector<HTMLButtonElement>('[aria-label="Mes siguiente"]')!.disabled).toBe(true)
  })
  it('shows errors as retryable, not as no availability', async () => {
    preview.mockResolvedValue({ ok: false, error: 'Error de conexión' })
    const host = document.createElement('div'); document.body.append(host); root = createRoot(host)
    await act(async () => root.render(<StepDateTime businessId="biz" timezone="America/Santiago" data={{ serviceId: 'cut', serviceIds: ['cut', 'nose'], professional: { kind: 'none' }, serviceModality: 'on_site', date: null } as BookingData} onDate={vi.fn()} onSelect={vi.fn()} onBack={vi.fn()} />))
    expect(host.textContent).toContain('Error de conexión')
    expect(host.textContent).toContain('Reintentar')
    expect(host.textContent).not.toContain('No hay horas en este mes')
    expect(preview).toHaveBeenCalledWith(expect.objectContaining({ serviceIds: ['cut', 'nose'], days: expect.any(Number) }))
  })
})
