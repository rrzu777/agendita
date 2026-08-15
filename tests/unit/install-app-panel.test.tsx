import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clickButton } from '../helpers/react-dom'
import '@/instrumentation-client'
import { InstallAppPanel } from '@/components/pwa/install-app-panel'

function installPromptEvent(prompt: () => Promise<void>) {
  const event = new Event('beforeinstallprompt', { cancelable: true })
  Object.assign(event, {
    prompt,
    userChoice: Promise.resolve({ outcome: 'accepted', platform: 'web' }),
  })
  return event
}

describe('InstallAppPanel', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn().mockReturnValue({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    })
    Object.defineProperty(navigator, 'standalone', { configurable: true, value: false })
    Object.defineProperty(navigator, 'userAgent', { configurable: true, value: 'Mozilla/5.0 Chrome/140' })
    Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, value: 0 })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    vi.restoreAllMocks()
  })

  async function renderPanel() {
    await act(async () => root.render(<InstallAppPanel />))
  }

  it('abre el prompt nativo sólo después del toque explícito', async () => {
    const prompt = vi.fn().mockResolvedValue(undefined)
    await renderPanel()
    const event = installPromptEvent(prompt)

    await act(async () => window.dispatchEvent(event))
    expect(prompt).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(true)

    await clickButton(container, 'Instalar ahora')

    expect(prompt).toHaveBeenCalledTimes(1)
  })

  it('conserva el prompt aunque llegue antes de hidratar el instalador', async () => {
    const prompt = vi.fn().mockResolvedValue(undefined)
    window.dispatchEvent(installPromptEvent(prompt))

    await renderPanel()
    await clickButton(container, 'Instalar ahora')

    expect(prompt).toHaveBeenCalledTimes(1)
  })

  it('en iPhone muestra los pasos manuales al tocar instalar', async () => {
    Object.defineProperty(navigator, 'userAgent', { configurable: true, value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)' })
    Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, value: 5 })
    await renderPanel()

    await clickButton(container, 'Instalar ahora')

    const button = [...container.querySelectorAll('button')].find((candidate) => candidate.textContent === 'Instalar ahora')
    const instructions = container.querySelector('#pwa-install-instructions')
    expect(button?.getAttribute('aria-expanded')).toBe('true')
    expect(button?.getAttribute('aria-controls')).toBe('pwa-install-instructions')
    expect(instructions?.getAttribute('role')).toBe('status')
    expect(container.textContent).toContain('Compartir')
    expect(container.textContent).toContain('Agregar a pantalla de inicio')
  })

  it.each([
    ['prompt', () => ({
      prompt: vi.fn().mockRejectedValue(new DOMException('expired', 'NotAllowedError')),
      userChoice: Promise.resolve({ outcome: 'dismissed' as const, platform: 'web' }),
    })],
    ['userChoice', () => {
      const userChoice = Promise.reject(new Error('browser choice failed'))
      void userChoice.catch(() => undefined)
      return {
        prompt: vi.fn().mockResolvedValue(undefined),
        userChoice,
      }
    }],
  ])('limpia un evento inválido cuando falla %s y ofrece instrucciones manuales', async (_label, makeFailure) => {
    const failure = makeFailure()
    const event = new Event('beforeinstallprompt', { cancelable: true })
    Object.assign(event, failure)
    await renderPanel()
    await act(async () => window.dispatchEvent(event))

    await expect(clickButton(container, 'Instalar ahora')).resolves.toBeUndefined()

    expect(container.textContent).toContain('Agregar a pantalla de inicio')
  })

  it('reconoce iPadOS cuando Safari se identifica como macOS', async () => {
    Object.defineProperty(navigator, 'userAgent', { configurable: true, value: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)' })
    Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, value: 5 })
    await renderPanel()

    await clickButton(container, 'Instalar ahora')

    expect(container.textContent).toContain('Compartir')
    expect(container.textContent).toContain('Agregar a pantalla de inicio')
  })

  it('reconoce que Agendita ya está instalada y no vuelve a ofrecer el botón', async () => {
    vi.mocked(window.matchMedia).mockReturnValue({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as MediaQueryList)

    await renderPanel()

    expect(container.textContent).toContain('Agendita ya está instalada')
    expect([...container.querySelectorAll('button')].some((button) => button.textContent === 'Instalar ahora')).toBe(false)
  })

  it('confirma la instalación cuando el navegador emite appinstalled', async () => {
    const prompt = vi.fn().mockResolvedValue(undefined)
    await renderPanel()
    await act(async () => window.dispatchEvent(installPromptEvent(prompt)))
    await clickButton(container, 'Instalar ahora')

    await act(async () => window.dispatchEvent(new Event('appinstalled')))

    expect(container.textContent).toContain('Agendita ya está instalada')
    expect(prompt).toHaveBeenCalledTimes(1)
  })
})
