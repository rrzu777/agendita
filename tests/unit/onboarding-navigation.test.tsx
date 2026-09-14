import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OnboardingWizard } from '@/components/onboarding/onboarding-wizard'

const { mockComplete, mockSave, mockPush, mockRefresh } = vi.hoisted(() => ({
  mockComplete: vi.fn(),
  mockSave: vi.fn(),
  mockPush: vi.fn(),
  mockRefresh: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, refresh: mockRefresh }),
}))
vi.mock('@/server/actions/onboarding', () => ({
  completeOnboarding: mockComplete,
  saveOnboardingStep: mockSave,
}))

const baseBusiness = {
  id: 'business',
  name: 'Negocio',
  slug: 'negocio',
  subdomain: 'negocio',
  city: 'Santiago',
  bio: null,
  addressText: null,
  whatsapp: null,
  instagram: null,
  depositPolicy: null,
  cancellationPolicy: null,
  bookingPolicy: null,
  onboardingStep: 0,
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((nextResolve) => { resolve = nextResolve })
  return { promise, resolve }
}

describe('initial setup navigation', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    mockComplete.mockReset().mockResolvedValue({ ok: true })
    mockSave.mockReset().mockResolvedValue({ ok: true })
    mockPush.mockReset()
    mockRefresh.mockReset()
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })

  async function renderWizard({
    onboardingStep = 0,
    servicesCount = 1,
    availabilityCount = 5,
  }: {
    onboardingStep?: number | null
    servicesCount?: number
    availabilityCount?: number
  } = {}) {
    await act(async () => {
      root.render(
        <OnboardingWizard
          business={{ ...baseBusiness, onboardingStep }}
          servicesCount={servicesCount}
          availabilityCount={availabilityCount}
          publicUrl="https://example.test"
          bookingUrl="https://example.test/book"
        />,
      )
    })
  }

  function tab(name: string) {
    const match = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="tab"]'))
      .find((candidate) => candidate.textContent?.includes(name))
    if (!match) throw new Error(`Tab not found: ${name}`)
    return match
  }

  it('offers five peer tabs and opens Horarios directly without next/back gates', async () => {
    await renderWizard()

    expect(container.querySelectorAll('[role="tab"]')).toHaveLength(5)
    expect(tab('Tu negocio').getAttribute('aria-selected')).toBe('true')

    await act(async () => tab('Horarios').click())

    expect(tab('Horarios').getAttribute('aria-selected')).toBe('true')
    const panel = container.querySelector('[role="tabpanel"]')
    expect(panel?.getAttribute('aria-labelledby')).toBe(tab('Horarios').id)
    expect(panel?.textContent).toContain('Define cuándo aceptas reservas')
    expect(container.textContent).not.toContain('Siguiente')
    expect(container.textContent).not.toContain('Anterior')
  })

  it('supports arrow-key navigation and keeps every tab at least 44px', async () => {
    await renderWizard()
    const first = tab('Tu negocio')
    first.focus()

    await act(async () => {
      first.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    })

    expect(tab('Servicios').getAttribute('aria-selected')).toBe('true')
    expect(document.activeElement).toBe(tab('Servicios'))
    for (const trigger of container.querySelectorAll('[role="tab"]')) {
      expect(trigger.classList.contains('min-h-11'), trigger.textContent ?? '').toBe(true)
      expect(trigger.classList.contains('min-w-11'), trigger.textContent ?? '').toBe(true)
    }
  })

  it.each([-1, 5, 2.5, Number.NaN])('falls back to the first panel for invalid persisted index %s', async (onboardingStep) => {
    await renderWizard({ onboardingStep })

    expect(tab('Tu negocio').getAttribute('aria-selected')).toBe('true')
    expect(container.querySelector('[role="tabpanel"]')?.textContent).toContain('Datos de tu negocio')
    expect(mockSave).not.toHaveBeenCalled()
  })

  it('shows readiness from business data rather than visited position', async () => {
    await renderWizard({ onboardingStep: 4, servicesCount: 0, availabilityCount: 5 })

    expect(tab('Servicios').getAttribute('data-ready')).toBe('false')
    expect(tab('Horarios').getAttribute('data-ready')).toBe('true')
    expect(tab('Listo para recibir reservas').getAttribute('data-ready')).toBe('false')
  })

  it('serializes rapid tab persistence so an older response cannot win', async () => {
    const firstSave = deferred<{ ok: true }>()
    mockSave.mockReturnValueOnce(firstSave.promise).mockResolvedValueOnce({ ok: true })
    await renderWizard()

    await act(async () => {
      tab('Servicios').click()
      tab('Horarios').click()
    })

    expect(tab('Horarios').getAttribute('aria-selected')).toBe('true')
    expect(mockSave).toHaveBeenCalledTimes(1)
    expect(mockSave).toHaveBeenNthCalledWith(1, 'business', 1)

    await act(async () => firstSave.resolve({ ok: true }))

    expect(mockSave).toHaveBeenCalledTimes(2)
    expect(mockSave).toHaveBeenNthCalledWith(2, 'business', 2)
  })

  it('does not claim clipboard success after rejection and allows retry', async () => {
    const writeText = vi.fn().mockRejectedValueOnce(new Error('denied')).mockResolvedValueOnce(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    await renderWizard({ onboardingStep: 4 })
    const copy = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
      .find((button) => button.textContent?.includes('Copiar'))!

    await act(async () => copy.click())
    expect(container.textContent).toContain('No pudimos copiar el enlace')
    expect(copy.textContent).toContain('Copiar')

    await act(async () => copy.click())
    expect(copy.textContent).toContain('Copiado')
    expect(container.textContent).not.toContain('No pudimos copiar el enlace')
  })

  it('blocks duplicate finish clicks and refreshes the dashboard after explicit completion', async () => {
    const completion = deferred<{ ok: true }>()
    mockComplete.mockReturnValue(completion.promise)
    await renderWizard({ onboardingStep: 4 })
    const finish = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
      .find((button) => button.textContent?.includes('Finalizar configuración'))!

    await act(async () => {
      finish.click()
      finish.click()
    })
    expect(mockComplete).toHaveBeenCalledTimes(1)
    expect(finish.disabled).toBe(true)

    await act(async () => completion.resolve({ ok: true }))
    expect(mockPush).toHaveBeenCalledWith('/dashboard')
    expect(mockRefresh).toHaveBeenCalledTimes(1)
  })

  it('waits for the last tab save before completing so onboardingStep stays cleared', async () => {
    const pendingSave = deferred<{ ok: true }>()
    mockSave.mockReturnValueOnce(pendingSave.promise)
    await renderWizard()

    await act(async () => tab('Listo para recibir reservas').click())
    const finish = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
      .find((button) => button.textContent?.includes('Finalizar configuración'))!
    await act(async () => finish.click())

    expect(mockSave).toHaveBeenCalledWith('business', 4)
    expect(mockComplete).not.toHaveBeenCalled()

    await act(async () => pendingSave.resolve({ ok: true }))

    expect(mockComplete).toHaveBeenCalledTimes(1)
  })

  it('keeps completion errors visible and retryable', async () => {
    mockComplete
      .mockResolvedValueOnce({ ok: false, error: 'Debes configurar al menos un día de atención antes de finalizar' })
      .mockResolvedValueOnce({ ok: true })
    await renderWizard({ onboardingStep: 4 })
    const finish = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
      .find((button) => button.textContent?.includes('Finalizar configuración'))!

    await act(async () => finish.click())
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Debes configurar')
    expect(finish.disabled).toBe(false)

    await act(async () => finish.click())
    expect(mockComplete).toHaveBeenCalledTimes(2)
    expect(mockPush).toHaveBeenCalledWith('/dashboard')
  })
})
