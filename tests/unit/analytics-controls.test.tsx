import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AnalyticsControls } from '@/components/dashboard/analytics/analytics-controls'
import { AnalyticsCaptureControl } from '@/components/dashboard/analytics/analytics-capture-control'
import { AcquisitionLinks } from '@/components/dashboard/analytics/acquisition-links'
import { AnalyticsDashboard } from '@/components/dashboard/analytics/analytics-dashboard'
import { analyticsDashboardFixture as report } from '../helpers/analytics-dashboard-fixture'
import { clickButton } from '../helpers/react-dom'
import type { AnalyticsOptionPage } from '@/server/analytics/options'

const mocks = vi.hoisted(() => ({ options: vi.fn(), capture: vi.fn(), create: vi.fn(), refresh: vi.fn() }))
vi.mock('@/server/actions/analytics', () => ({ getOwnerAnalyticsOptions: mocks.options, setAnalyticsCollectionEnabled: mocks.capture, createAcquisitionLink: mocks.create, archiveAcquisitionLink: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }))
let host: HTMLDivElement, root: Root
beforeEach(() => {
  vi.clearAllMocks()
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  mocks.options.mockResolvedValue({ ok: true, data: { rows: [{ id: 'owned-1', label: 'Propia' }], page: 1, hasMore: true, selected: null } })
})
afterEach(async () => { await act(async () => root.unmount()); host.remove() })
async function select(label: string, value: string) {
  const input = host.querySelector<HTMLSelectElement>(`[aria-label="${label}"]`)!
  await act(async () => { input.value = value; input.dispatchEvent(new Event('change', { bubbles: true })) })
}

describe('actual analytics management controls', () => {
  it('resets displayed controls to the new server query after preset or filter navigation', async () => {
    await act(async () => root.render(<AnalyticsDashboard report={report} periodMode={{ days: 28 }} />))
    await act(async () => root.render(<AnalyticsDashboard report={{ ...report, period: { ...report.period, from: '2026-08-22' }, filter: { ...report.filter, channel: 'facebook' } }} periodMode={{ days: 7 }} />))
    expect(host.querySelector<HTMLSelectElement>('[aria-label="Período de métricas"]')!.value).toBe('7')
    expect(host.querySelector<HTMLSelectElement>('[aria-label="Canal histórico"]')?.value).toBe('facebook')
    expect(host.querySelector<HTMLInputElement>('[name="from"]')!.value).toBe('2026-08-22')
  })
  it('prevents an inverted custom period and explains it before navigation', async () => {
    await act(async () => root.render(<AnalyticsControls report={report} periodMode={{ days: null }} />))
    const form = host.querySelector('form')!
    host.querySelector<HTMLInputElement>('[name="from"]')!.value = '2026-08-29'
    host.querySelector<HTMLInputElement>('[name="to"]')!.value = '2026-08-01'
    const submit = new Event('submit', { bubbles: true, cancelable: true })
    await act(async () => { form.dispatchEvent(submit) })
    expect(submit.defaultPrevented).toBe(true)
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('La fecha final debe ser posterior')
  })
  it('submits custom dates and exactly one grain, clearing incompatible fields and resetting page', async () => {
    await act(async () => root.render(<AnalyticsControls report={{ ...report, filter: { ...report.filter, channel: 'instagram' }, services: { ...report.services, page: 4 } }} periodMode={{ days: 28 }} />))
    await select('Período de métricas', 'custom')
    await select('Tipo de filtro histórico', 'serviceId')
    expect(new FormData(host.querySelector('form')!).has('channel')).toBe(false)
    expect(host.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true)
    await select('Servicio histórico', 'owned-1')
    const values = new FormData(host.querySelector('form')!)
    expect(Object.fromEntries(values)).toEqual({ from: report.period.from, to: report.period.to, serviceId: 'owned-1', page: '1', pageSize: '25' })
    await select('Tipo de filtro histórico', 'acquisitionLinkId')
    expect(new FormData(host.querySelector('form')!).has('serviceId')).toBe(false)
    await select('Enlace histórico', 'owned-1')
    expect(new FormData(host.querySelector('form')!).get('acquisitionLinkId')).toBe('owned-1')
    await select('Período de métricas', '7')
    expect(new FormData(host.querySelector('form')!).has('from')).toBe(false)
    expect(new FormData(host.querySelector('form')!).get('days')).toBe('7')
  })
  it('continues bounded choices, searches from page one and exposes failures without changing metrics', async () => {
    await act(async () => root.render(<AnalyticsControls report={{ ...report, filter: { ...report.filter, serviceId: 'owned-1' } }} periodMode={{ days: 28 }} />))
    await clickButton(host, 'Más opciones')
    expect(mocks.options).toHaveBeenLastCalledWith({ kind: 'service', page: 2, search: '', selectedId: 'owned-1' })
    mocks.options.mockResolvedValueOnce({ ok: false, error: 'Opciones no disponibles.' })
    await clickButton(host, 'Buscar')
    expect(mocks.options).toHaveBeenLastCalledWith({ kind: 'service', page: 1, search: '', selectedId: 'owned-1' })
    expect(host.querySelector('[role="alert"]')?.textContent).toBe('Opciones no disponibles.')
    expect(new FormData(host.querySelector('form')!).get('serviceId')).toBe('owned-1')
    expect(host.textContent).not.toContain('0 visitas')
  })
  it('preserves an out-of-page current filter through pagination, search and apply with an honest label', async () => {
    await act(async () => root.render(<AnalyticsControls report={{ ...report, filter: { ...report.filter, serviceId: 'historical-outside-page' } }} periodMode={{ days: 28 }} />))
    const assertCurrent = () => {
      expect(host.querySelector<HTMLSelectElement>('[aria-label="Servicio histórico"]')!.selectedOptions[0].textContent).toBe('Selección actual · nombre no disponible en esta página · historical-outside-page')
      expect(new FormData(host.querySelector('form')!).get('serviceId')).toBe('historical-outside-page')
      expect(host.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(false)
    }
    assertCurrent()
    await clickButton(host, 'Más opciones')
    assertCurrent()
    const search = host.querySelector<HTMLInputElement>('[aria-label="Buscar servicio histórico"]')!
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(search, 'histórico'); search.dispatchEvent(new Event('input', { bubbles: true })) })
    await clickButton(host, 'Buscar')
    expect(mocks.options).toHaveBeenLastCalledWith({ kind: 'service', page: 1, search: 'histórico', selectedId: 'historical-outside-page' })
    assertCurrent()
    const submit = new Event('submit', { bubbles: true, cancelable: true })
    await act(async () => { host.querySelector('form')!.dispatchEvent(submit) })
    expect(submit.defaultPrevented).toBe(false)
    assertCurrent()
  })
  it('forwards only an optional owned promotion association and exposes denied creation', async () => {
    mocks.create.mockResolvedValue({ ok: false, error: 'Promoción no disponible' })
    await act(async () => root.render(<AcquisitionLinks links={report.acquisitionLinks} />))
    const input = host.querySelector<HTMLInputElement>('#analytics-campaign')!
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'Campaña'); input.dispatchEvent(new Event('input', { bubbles: true })) })
    await select('Promoción opcional', 'owned-1')
    await clickButton(host, 'Crear enlace')
    expect(mocks.create).toHaveBeenCalledWith({ channel: 'instagram', campaignName: 'Campaña', promotionId: 'owned-1' })
    expect(host.textContent).toContain('Promoción no disponible')
    expect(host.textContent).not.toContain('Enlace creado:')
  })
  it.each(['service', 'promotion'] as const)('keeps the current %s identity and never borrows a stale selection label after pagination', async kind => {
    const first = { id: 'owned-a', label: 'Nombre A' }
    const second = { id: 'owned-b', label: 'Nombre B' }
    mocks.options.mockResolvedValueOnce({ ok: true, data: { rows: [first, second], page: 1, hasMore: true, selected: kind === 'service' ? first : null } })
    await act(async () => root.render(kind === 'service'
      ? <AnalyticsControls report={{ ...report, filter: { ...report.filter, serviceId: first.id } }} periodMode={{ days: 28 }} />
      : <AcquisitionLinks links={report.acquisitionLinks} />))
    const label = kind === 'service' ? 'Servicio histórico' : 'Promoción opcional'
    await select(label, first.id)
    let resolvePage!: (value: { ok: true; data: AnalyticsOptionPage }) => void
    mocks.options.mockReturnValueOnce(new Promise<{ ok: true; data: AnalyticsOptionPage }>(resolve => { resolvePage = resolve }))
    await clickButton(host, 'Más opciones')
    expect(mocks.options).toHaveBeenLastCalledWith({ kind, page: 2, search: '', selectedId: first.id })
    await select(label, second.id)
    expect(host.querySelector<HTMLSelectElement>(`[aria-label="${label}"]`)!.selectedOptions[0].textContent).toBe('Nombre B')
    await act(async () => resolvePage({ ok: true, data: { rows: [first], page: 2, hasMore: false, selected: first } }))
    const current = host.querySelector<HTMLSelectElement>(`[aria-label="${label}"]`)!
    expect(current.value).toBe('owned-b')
    expect(current.selectedOptions[0].textContent).not.toContain('Nombre A')
    expect(current.selectedOptions[0].textContent).toContain('owned-b')
    if (kind === 'service') {
      expect(new FormData(host.querySelector('form')!).get('serviceId')).toBe('owned-b')
    } else {
      mocks.create.mockResolvedValueOnce({ ok: false, error: 'Creación no disponible' })
      const input = host.querySelector<HTMLInputElement>('#analytics-campaign')!
      await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'Campaña'); input.dispatchEvent(new Event('input', { bubbles: true })) })
      await clickButton(host, 'Crear enlace')
      expect(mocks.create).toHaveBeenCalledWith({ channel: 'instagram', campaignName: 'Campaña', promotionId: 'owned-b' })
    }
  })
  it('names a retained promotion association from the separate options response', async () => {
    await act(async () => root.render(<AcquisitionLinks links={{ ...report.acquisitionLinks, rows: [{ ...report.acquisitionLinks.rows[0], promotionId: 'owned-1' }] }} />))
    expect(host.querySelector('[aria-label="Enlaces de adquisición"]')?.textContent).toContain('Promoción asociada: Propia')
  })
  it('keeps closing an open period accessible with global capture off, and never reports failed enable as success', async () => {
    mocks.capture.mockResolvedValueOnce({ ok: true, data: { enabled: false } })
    await act(async () => root.render(<AnalyticsCaptureControl capture={{ ...report.capture, enabled: false, collectionOpen: true, status: 'disabled' }} />))
    await clickButton(host, 'Cerrar captura')
    expect(mocks.capture).toHaveBeenCalledWith(false)
    expect(host.textContent).toContain('Período de captura cerrado.')
    expect(mocks.refresh).toHaveBeenCalledTimes(1)
    await act(async () => root.render(<AnalyticsCaptureControl key="closed" capture={{ ...report.capture, enabled: false, collectionOpen: false, status: 'disabled' }} />))
    mocks.capture.mockResolvedValueOnce({ ok: false, error: 'La captura aún no cumple los requisitos de configuración, privacidad o piloto.' })
    await clickButton(host, 'Abrir captura')
    expect(mocks.capture).toHaveBeenLastCalledWith(true)
    expect(host.textContent).toContain('no cumple los requisitos')
    expect(host.textContent).not.toContain('Período de captura abierto.')
    expect(mocks.refresh).toHaveBeenCalledTimes(1)
  })
})
