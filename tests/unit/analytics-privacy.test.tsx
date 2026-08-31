import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it } from 'vitest'
import PrivacyPage from '@/app/privacy/page'
import { PublicAnalytics } from '@/components/analytics/public-analytics'
import { clickButton } from '../helpers/react-dom'

let root: Root | undefined
afterEach(() => {
  act(() => root?.unmount())
  root = undefined
  document.body.replaceChildren()
  window.localStorage.clear()
  window.sessionStorage.clear()
})

describe('analytics privacy notice access without losing the booking', () => {
  it('links to a real notice section in a separate tab before and after declining consent', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    await act(async () => root!.render(<PublicAnalytics businessId="privacy-fixture" slug="privacy-fixture" timezone="UTC" eligible surface="booking"><input aria-label="Borrador de reserva" defaultValue="Selección conservada" /></PublicAnalytics>))
    const assertNoticeLink = () => {
      const link = host.querySelector<HTMLAnchorElement>('aside a')
      expect(link, 'The consent card must provide access to the detailed notice').not.toBeNull()
      expect(link!.getAttribute('href')).toBe('/privacy#metricas-reservas')
      expect(link!.target).toBe('_blank')
      expect(link!.rel.split(' ')).toEqual(expect.arrayContaining(['noopener', 'noreferrer']))
      expect(link!.textContent).toMatch(/otra pestaña/)
      const notice = document.createElement('div')
      notice.innerHTML = renderToStaticMarkup(<PrivacyPage />)
      const section = notice.querySelector(new URL(link!.href).hash)
      expect(section?.querySelector('h2')).not.toBeNull()
    }
    assertNoticeLink()
    await clickButton(host, 'Continuar sin métricas')
    assertNoticeLink()
    expect(host.querySelector('input')!.value).toBe('Selección conservada')
    expect(host.textContent).toContain('Métricas no permitidas')
  })
})
