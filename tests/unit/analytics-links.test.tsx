import { renderToStaticMarkup } from 'react-dom/server'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { clickButton, flushPromises } from '../helpers/react-dom'
import { AcquisitionLinks, acquisitionActionMessage } from '@/components/dashboard/analytics/acquisition-links'
import type { OwnerAnalyticsReport } from '@/server/analytics/reports'

const links = {
  rows: [{ id: 'new-link', channel: 'instagram', campaignName: 'Nuevo sin tráfico', promotionId: null, createdAt: '2026-08-31T00:00:00.000Z', archivedAt: null, url: 'https://analytics.e2e.test/book?acq=opaque-token' }],
  page: 1,
  pageSize: 25,
  total: 1,
} satisfies OwnerAnalyticsReport['acquisitionLinks']

const originalScrollIntoView = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView')
afterEach(() => {
  expect(Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView')).toEqual(originalScrollIntoView)
})

describe('AcquisitionLinks', () => {
  it('renders a manageable registry link even before an aggregate has traffic', () => {
    const markup = renderToStaticMarkup(<AcquisitionLinks links={links} />)

    expect(markup).toContain('Nuevo sin tráfico')
    expect(markup).toContain('https://analytics.e2e.test/book?acq=opaque-token')
    expect(markup).toContain('Copiar Nuevo sin tráfico')
  })

  it('renders next-page navigation preserving the supplied metrics query', () => {
    const markup = renderToStaticMarkup(<AcquisitionLinks links={{ ...links, total: 26 }} pagination={{ previousHref: null, nextHref: '/dashboard/metricas?from=2026-08-01&to=2026-08-29&channel=instagram&page=2', label: 'Página 1 de 2' }} />)

    expect(markup).toContain('Página 1 de 2')
    expect(markup).toContain('Siguiente enlaces')
    expect(markup).toContain('from=2026-08-01&amp;to=2026-08-29&amp;channel=instagram&amp;page=2')
  })

  it('keeps an ok:false action response visible instead of reporting success', () => {
    expect(acquisitionActionMessage({ ok: false, error: 'No autorizado.' })).toBe('No autorizado.')
  })

  it('invokes create and visibly reports an ok:false response without success or refresh', async () => {
    vi.resetModules()
    const create = vi.fn().mockResolvedValue({ ok: false, error: 'No autorizado.' })
    vi.doMock('@/server/actions/analytics', () => ({ createAcquisitionLink: create, archiveAcquisitionLink: vi.fn() }))
    const { AcquisitionLinks: InteractiveLinks } = await import('@/components/dashboard/analytics/acquisition-links')
    HTMLElement.prototype.scrollIntoView = vi.fn()
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    try {
      await act(async () => { root.render(<InteractiveLinks links={links} pagination={{ previousHref: null, nextHref: null, label: 'Página 1 de 1' }} />) })
      const input = host.querySelector<HTMLInputElement>('#analytics-campaign')!
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      await act(async () => { setter.call(input, 'Fallará'); input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })) })
      await clickButton(host, 'Crear enlace')
      await flushPromises()
      expect(create).toHaveBeenCalledWith({ channel: 'instagram', campaignName: 'Fallará' })
      expect(host.textContent).toContain('No autorizado.')
      expect(host.textContent).not.toContain('Enlace creado:')
    } finally {
      await act(async () => root.unmount())
      host.remove()
      vi.doUnmock('@/server/actions/analytics')
      if (originalScrollIntoView) Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', originalScrollIntoView)
      else Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView')
    }
  })
})
