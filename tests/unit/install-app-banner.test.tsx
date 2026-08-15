import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clickButton } from '../helpers/react-dom'
import { InstallAppBanner } from '@/components/pwa/install-app-banner'

const DISMISSAL_KEY = 'agendita:pwa-install-dismissed-until'
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000

describe('InstallAppBanner', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-08-15T12:00:00Z'))
    const values = new Map<string, string>()
    const storage: Storage = {
      get length() { return values.size },
      clear: () => values.clear(),
      getItem: (key) => values.get(key) ?? null,
      key: (index) => [...values.keys()][index] ?? null,
      removeItem: (key) => { values.delete(key) },
      setItem: (key, value) => { values.set(key, String(value)) },
    }
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: storage,
    })
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn().mockReturnValue({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    if (root) await act(async () => root.unmount())
    container?.remove()
    window.localStorage.clear()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  async function renderBanner() {
    await act(async () => {
      root.render(<InstallAppBanner canonicalOrigin="https://www.agendita.cl" />)
    })
  }

  it('muestra el instalador canónico cuando la app no está instalada', async () => {
    await renderBanner()

    const banner = container.querySelector('aside')
    const link = container.querySelector('a')
    expect(banner?.hidden).toBe(false)
    expect(link?.href).toBe('https://www.agendita.cl/instalar')
  })

  it('Ahora no lo oculta durante 30 días y luego permite mostrarlo otra vez', async () => {
    await renderBanner()
    await clickButton(container, 'Ahora no')

    expect(container.querySelector('aside')?.hidden).toBe(true)
    expect(Number(window.localStorage.getItem(DISMISSAL_KEY)))
      .toBe(Date.now() + THIRTY_DAYS_MS)

    await act(async () => root.unmount())
    root = createRoot(container)
    vi.setSystemTime(Date.now() + THIRTY_DAYS_MS - 1)
    await renderBanner()
    expect(container.querySelector('aside')?.hidden).toBe(true)

    await act(async () => root.unmount())
    root = createRoot(container)
    vi.setSystemTime(Date.now() + 2)
    await renderBanner()
    expect(container.querySelector('aside')?.hidden).toBe(false)
  })

  it('permanece oculto cuando Agendita ya corre en modo instalado', async () => {
    vi.mocked(window.matchMedia).mockReturnValue({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as MediaQueryList)

    await renderBanner()

    expect(container.querySelector('aside')?.hidden).toBe(true)
  })

  it('al seguir el enlace canónico evita repetir el banner al volver', async () => {
    await renderBanner()
    const link = container.querySelector('a')
    link?.addEventListener('click', (event) => event.preventDefault())

    await act(async () => link?.click())

    expect(container.querySelector('aside')?.hidden).toBe(true)
    expect(Number(window.localStorage.getItem(DISMISSAL_KEY)))
      .toBe(Date.now() + THIRTY_DAYS_MS)
  })

  it('Ahora no también funciona cuando el navegador restringe el almacenamiento', async () => {
    vi.spyOn(window.localStorage, 'getItem').mockImplementation(() => { throw new DOMException('blocked') })
    vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => { throw new DOMException('blocked') })
    await renderBanner()

    await clickButton(container, 'Ahora no')

    expect(container.querySelector('aside')?.hidden).toBe(true)
  })
})
