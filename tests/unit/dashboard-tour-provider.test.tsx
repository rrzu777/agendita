import { act, StrictMode, type ComponentProps } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetTourProgress, mockRecordTourProgress, mockLoadTourDefinition } = vi.hoisted(() => ({
  mockGetTourProgress: vi.fn(),
  mockRecordTourProgress: vi.fn(),
  mockLoadTourDefinition: vi.fn(),
}))

vi.mock('@/server/actions/tour-progress', () => ({
  getTourProgress: mockGetTourProgress,
  recordTourProgress: mockRecordTourProgress,
}))

vi.mock('@/components/dashboard/tours/tour-definitions', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/components/dashboard/tours/tour-definitions')>(),
  loadTourDefinition: mockLoadTourDefinition,
}))

let pathname = '/dashboard'
let mobileViewport = false
vi.mock('next/navigation', () => ({
  usePathname: () => pathname,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}))

import {
  UnsavedChangesProvider,
  useUnsavedChangesRegistration,
} from '@/components/dashboard/unsaved-changes-provider'
import {
  DashboardTourProvider,
} from '@/components/dashboard/tours/dashboard-tour-provider'
import { useDashboardTours } from '@/components/dashboard/tours/tour-context'
import { TourInvitation } from '@/components/dashboard/tours/tour-invitation'
import { MobileMoreMenu } from '@/components/dashboard/mobile-more-menu'
import type { TourDefinition } from '@/components/dashboard/tours/tour-types'

const definition = {
  key: 'dashboard_intro',
  version: 1,
  route: '/dashboard',
  roles: ['owner', 'admin'],
  title: 'Primeros pasos',
  steps: [
    {
      id: 'first',
      targetKind: 'static',
      targetId: 'nav-desktop',
      title: 'Primer paso',
      body: 'Primera explicación.',
      viewports: ['desktop', 'mobile'],
      waitMs: 20,
    },
    {
      id: 'second',
      targetKind: 'static',
      targetId: 'nav-desktop',
      title: 'Segundo paso',
      body: 'Segunda explicación.',
      viewports: ['desktop', 'mobile'],
      waitMs: 20,
    },
  ],
} satisfies TourDefinition

function Controls() {
  const tours = useDashboardTours()
  return (
    <div>
      <button type="button" onClick={() => { void tours.start('dashboard_intro') }}>
        Iniciar recorrido
      </button>
      <button type="button" onClick={() => { void tours.start('dashboard_intro', { replay: true }) }}>
        Repetir recorrido
      </button>
      <button type="button" onClick={() => { void tours.start('bookings') }}>
        Iniciar reservas
      </button>
      <button type="button" onClick={() => { void tours.start('settings') }}>
        Iniciar configuración
      </button>
      <button type="button" onClick={tours.closeReplay}>
        Cerrar repetición
      </button>
      <output data-testid="available">{tours.available.join(',')}</output>
      <output data-testid="active">{tours.active ? `${tours.active.key}:${tours.active.step}` : 'none'}</output>
    </div>
  )
}

function DirtyRegistration({ dirty }: { dirty: boolean }) {
  useUnsavedChangesRegistration({ scope: 'profile', isDirty: dirty, discard: vi.fn() })
  return null
}

function buttonNamed(name: string) {
  const button = Array.from(document.querySelectorAll('button')).find((candidate) => candidate.textContent?.trim() === name)
  if (!button) throw new Error(`Button not found: ${name}`)
  return button as HTMLButtonElement
}

async function click(name: string) {
  await act(async () => {
    buttonNamed(name).click()
    await Promise.resolve()
    await Promise.resolve()
  })
}

async function settle(delay = 0) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, delay))
  })
}

function appendTourTarget(tourId: string) {
  const element = document.createElement('div')
  element.dataset.tourId = tourId
  element.scrollIntoView = vi.fn()
  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue(new DOMRect(20, 30, 100, 40))
  document.body.appendChild(element)
  return element
}

describe('DashboardTourProvider', () => {
  let container: HTMLDivElement
  let root: Root
  let target: HTMLButtonElement

  beforeEach(() => {
    pathname = '/dashboard'
    mobileViewport = false
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    target = document.createElement('button')
    target.dataset.tourId = 'nav-desktop'
    target.scrollIntoView = vi.fn()
    vi.spyOn(target, 'getBoundingClientRect').mockReturnValue(new DOMRect(20, 30, 100, 40))
    document.body.appendChild(target)
    vi.stubGlobal('matchMedia', vi.fn().mockImplementation((query: string) => ({
      matches: query === '(max-width: 767px)' ? mobileViewport : false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })))
    mockGetTourProgress.mockResolvedValue({ ok: true, data: [] })
    mockRecordTourProgress.mockResolvedValue({
      ok: true,
      data: { key: 'dashboard_intro', version: 1, status: 'in_progress', lastStep: 0 },
    })
    mockLoadTourDefinition.mockResolvedValue(definition)
  })

  afterEach(async () => {
    vi.useRealTimers()
    await act(async () => root.unmount())
    document.body.replaceChildren()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    vi.clearAllMocks()
  })

  type ProviderOptions = Pick<
    ComponentProps<typeof DashboardTourProvider>,
    'role' | 'onboardingCompleted' | 'toursEnabled'
  > & { dirty?: boolean; withPromptSurface?: boolean; withInvitation?: boolean; withMobileMore?: boolean }

  async function renderProvider({
    dirty = false,
    role = 'owner',
    onboardingCompleted = true,
    toursEnabled = true,
    withPromptSurface = false,
    withInvitation = false,
    withMobileMore = false,
  }: Partial<ProviderOptions> = {}) {
    await act(async () => root.render(
      <UnsavedChangesProvider>
        <DashboardTourProvider
          role={role}
          onboardingCompleted={onboardingCompleted}
          toursEnabled={toursEnabled}
        >
          <DirtyRegistration dirty={dirty} />
          {withPromptSurface && <div data-interruptive-surface>Install prompt</div>}
          <Controls />
          {withInvitation && <TourInvitation />}
          {withMobileMore && <MobileMoreMenu items={[]} pathname={pathname} onSignOut={() => undefined} />}
        </DashboardTourProvider>
      </UnsavedChangesProvider>,
    ))
    await settle()
  }

  it('never auto-starts and records start only after explicit activation', async () => {
    await renderProvider()

    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(document.querySelector('[data-testid="available"]')?.textContent).toBe('dashboard_intro')

    await click('Iniciar recorrido')

    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Primer paso')
    expect(mockRecordTourProgress).toHaveBeenCalledWith({
      key: 'dashboard_intro',
      version: 1,
      event: { type: 'start' },
    })
  })

  it('hides the provider invitation when the rollout flag is absent or false', async () => {
    await renderProvider({ toursEnabled: false, withInvitation: true })

    expect(container.textContent).not.toContain('Conoce Agendita en 2 minutos')

    await renderProvider({ toursEnabled: true, withInvitation: true })

    expect(container.textContent).toContain('Conoce Agendita en 2 minutos')
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })

  it('keeps async guards live when React StrictMode replays effects', async () => {
    await act(async () => root.render(
      <StrictMode>
        <UnsavedChangesProvider>
          <DashboardTourProvider role="owner" onboardingCompleted toursEnabled>
            <Controls />
          </DashboardTourProvider>
        </UnsavedChangesProvider>
      </StrictMode>,
    ))
    await settle()

    expect(document.querySelector('[data-testid="available"]')?.textContent).toBe('dashboard_intro')
  })

  it('resumes an in-progress tour at its persisted step', async () => {
    mockGetTourProgress.mockResolvedValue({
      ok: true,
      data: [{ key: 'dashboard_intro', version: 1, status: 'in_progress', lastStep: 1 }],
    })
    await renderProvider()

    await click('Iniciar recorrido')

    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Segundo paso')
    expect(document.querySelector('[data-testid="active"]')?.textContent).toBe('dashboard_intro:1')
  })

  it('keeps back navigation local and persists only the highest forward step after debounce', async () => {
    await renderProvider()
    await click('Iniciar recorrido')
    mockRecordTourProgress.mockClear()
    vi.useFakeTimers()

    await click('Siguiente')
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Segundo paso')
    await click('Atrás')
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Primer paso')
    await act(async () => vi.advanceTimersByTimeAsync(300))

    expect(mockRecordTourProgress).toHaveBeenCalledTimes(1)
    expect(mockRecordTourProgress).toHaveBeenCalledWith({
      key: 'dashboard_intro',
      version: 1,
      event: { type: 'step', step: 1 },
    })
  })

  it('completes terminally and removes the surface', async () => {
    await renderProvider()
    await click('Iniciar recorrido')
    await click('Siguiente')
    mockRecordTourProgress.mockClear()

    await click('Terminar')

    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(document.querySelector('[data-testid="active"]')?.textContent).toBe('none')
    expect(mockRecordTourProgress).toHaveBeenCalledWith({
      key: 'dashboard_intro',
      version: 1,
      event: { type: 'complete' },
    })
  })

  it('completes the route-local Settings tour on Profile without a policy form target', async () => {
    pathname = '/dashboard/settings/profile'
    target.dataset.tourId = 'settings-navigation'
    appendTourTarget('settings-preview')
    appendTourTarget('settings-save')
    const { definition: settings } = await import('@/components/dashboard/tours/definitions/settings')
    mockLoadTourDefinition.mockResolvedValue(settings)
    await renderProvider()

    await click('Iniciar configuración')
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Ordena la configuración')
    await click('Siguiente')
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Revisa tu perfil público')
    await click('Siguiente')
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Guarda los cambios')
    await click('Siguiente')
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Define políticas y avisos')
    await click('Terminar')

    expect(document.querySelector('[data-testid="active"]')?.textContent).toBe('none')
    expect(mockRecordTourProgress).toHaveBeenCalledWith({
      key: 'settings',
      version: 1,
      event: { type: 'complete' },
    })
  })

  it('completes Bookings when terminal rows have no action target', async () => {
    pathname = '/dashboard/bookings'
    target.dataset.tourId = 'bookings-new'
    appendTourTarget('bookings-search')
    const { definition: bookings } = await import('@/components/dashboard/tours/definitions/bookings')
    mockLoadTourDefinition.mockResolvedValue(bookings)
    await renderProvider()

    await click('Iniciar reservas')
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Crea una reserva')
    await click('Siguiente')
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Busca una reserva')
    await click('Siguiente')
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Revisa transferencias')
    await click('Siguiente')
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Consulta el estado y saldo')
    await click('Siguiente')
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Gestiona la reserva')
    await click('Terminar')

    expect(document.querySelector('[data-testid="active"]')?.textContent).toBe('none')
    expect(mockRecordTourProgress).toHaveBeenCalledWith({
      key: 'bookings',
      version: 1,
      event: { type: 'complete' },
    })
  })

  it('restores launcher focus only when the session closes, not between steps', async () => {
    await renderProvider()
    const launcher = buttonNamed('Iniciar recorrido')
    launcher.focus()
    const focus = vi.spyOn(launcher, 'focus')
    await click('Iniciar recorrido')
    focus.mockClear()

    await click('Siguiente')
    expect(focus).not.toHaveBeenCalled()

    await click('Terminar')
    expect(focus).toHaveBeenCalledTimes(1)
    expect(document.activeElement).toBe(launcher)
  })

  it('dismisses a normal session and persists the terminal choice', async () => {
    await renderProvider()
    await click('Iniciar recorrido')
    mockRecordTourProgress.mockClear()

    await click('Omitir recorrido')

    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(mockRecordTourProgress).toHaveBeenCalledWith({
      key: 'dashboard_intro',
      version: 1,
      event: { type: 'dismiss' },
    })
  })

  it('flushes a pending forward step before the terminal dismiss event', async () => {
    await renderProvider()
    await click('Iniciar recorrido')
    mockRecordTourProgress.mockClear()

    await click('Siguiente')
    await click('Omitir recorrido')
    await settle()

    expect(mockRecordTourProgress.mock.calls.map(([input]) => input.event)).toEqual([
      { type: 'step', step: 1 },
      { type: 'dismiss' },
    ])
  })

  it('replays a terminal tour locally without resetting server progress', async () => {
    mockGetTourProgress.mockResolvedValue({
      ok: true,
      data: [{ key: 'dashboard_intro', version: 1, status: 'completed', lastStep: 1 }],
    })
    await renderProvider()
    expect(document.querySelector('[data-testid="available"]')?.textContent).toBe('')

    await click('Repetir recorrido')

    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Primer paso')
    expect(mockRecordTourProgress).not.toHaveBeenCalled()
    await click('Cerrar repetición')
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(mockRecordTourProgress).not.toHaveBeenCalled()
  })

  it('aborts target work and removes every tour layer on route change', async () => {
    target.remove()
    mockLoadTourDefinition.mockResolvedValue({
      ...definition,
      steps: definition.steps.map((item) => ({ ...item, waitMs: 500 })),
    })
    await renderProvider()
    await click('Iniciar recorrido')

    pathname = '/dashboard/bookings'
    await renderProvider()
    target.dataset.tourId = 'nav-desktop'
    document.body.appendChild(target)
    await settle()

    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(document.querySelector('[data-tour-highlight]')).toBeNull()
    expect(document.querySelector('[data-slot="sheet-overlay"]')).toBeNull()
  })

  it('keeps local interaction usable when progress persistence fails', async () => {
    mockRecordTourProgress.mockRejectedValue(new Error('offline'))
    await renderProvider()

    await click('Iniciar recorrido')
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Primer paso')
    await click('Siguiente')
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Segundo paso')
  })

  it('fails open without leaving an overlay when every target times out', async () => {
    target.remove()
    await renderProvider()

    await click('Iniciar recorrido')
    await settle(30)

    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(document.querySelector('[data-tour-highlight]')).toBeNull()
    expect(document.querySelector('[data-slot="sheet-overlay"]')).toBeNull()
    expect(mockRecordTourProgress).not.toHaveBeenCalledWith(expect.objectContaining({ event: { type: 'complete' } }))
  })

  it('pauses while a form is dirty and does not advance', async () => {
    await renderProvider({ dirty: true })
    await click('Iniciar recorrido')
    mockRecordTourProgress.mockClear()

    expect(document.querySelector('[role="dialog"]')?.textContent)
      .toContain('Termina o descarta tus cambios para continuar')
    expect(buttonNamed('Siguiente').disabled).toBe(true)
    await click('Siguiente')
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Primer paso')
    expect(mockRecordTourProgress).not.toHaveBeenCalled()
  })

  it('does not start above an already open interactive surface', async () => {
    const blockingSurface = document.createElement('div')
    blockingSurface.dataset.interruptiveSurface = ''
    blockingSurface.dataset.state = 'open'
    document.body.appendChild(blockingSurface)
    await renderProvider()

    await click('Iniciar recorrido')

    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(mockRecordTourProgress).not.toHaveBeenCalled()
  })

  it('pauses an active tour when an interactive surface opens', async () => {
    await renderProvider()
    await click('Iniciar recorrido')
    const blockingSurface = document.createElement('div')
    blockingSurface.dataset.interruptiveSurface = ''
    blockingSurface.dataset.state = 'open'
    document.body.appendChild(blockingSurface)
    await settle()

    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(document.querySelector('[data-testid="active"]')?.textContent).toBe('dashboard_intro:0')
  })

  it('hides the mobile tour overlay for an aria-modal-only interruptive surface', async () => {
    mobileViewport = true
    await renderProvider()
    await click('Iniciar recorrido')
    expect(document.querySelector('[data-slot="sheet-overlay"]')).not.toBeNull()
    const blockingSurface = document.createElement('div')
    blockingSurface.dataset.interruptiveSurface = ''
    blockingSurface.setAttribute('aria-modal', 'true')
    document.body.appendChild(blockingSurface)
    await settle()

    expect(document.querySelector('[data-slot="sheet-overlay"]')).toBeNull()
    expect(getComputedStyle(blockingSurface).display).not.toBe('none')
    expect(document.querySelector('[data-testid="active"]')?.textContent).toBe('dashboard_intro:0')
  })

  it('waits for the animated Más Sheet exit before starting mobile replay at 375px', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 375 })
    mobileViewport = true
    mockGetTourProgress.mockResolvedValue({
      ok: true,
      data: [{ key: 'dashboard_intro', version: 1, status: 'completed', lastStep: 1 }],
    })
    mockLoadTourDefinition.mockResolvedValue({
      ...definition,
      steps: definition.steps.map((step) => ({ ...step, targetId: 'nav-mobile-more' })),
    })
    await renderProvider({ withMobileMore: true })
    const mobileMore = document.querySelector<HTMLElement>('[data-tour-id="nav-mobile-more"]')
    vi.spyOn(mobileMore!, 'getBoundingClientRect').mockReturnValue(new DOMRect(20, 30, 100, 40))

    await click('Más')
    expect(document.querySelector('[data-mobile-more-sheet]')).not.toBeNull()
    await click('Ayuda y recorridos')
    const help = document.querySelector('[aria-label="Recorridos disponibles"]') as HTMLElement
    const replay = Array.from(help.querySelectorAll('button'))
      .find((button) => button.textContent === 'Repetir recorrido')
    const exitingMoreContent = document.createElement('div')
    exitingMoreContent.setAttribute('data-mobile-more-sheet', '')
    exitingMoreContent.dataset.state = 'closed'
    const exitingMoreOverlay = document.createElement('div')
    exitingMoreOverlay.dataset.slot = 'sheet-overlay'
    exitingMoreOverlay.dataset.state = 'closed'
    document.body.append(exitingMoreContent, exitingMoreOverlay)
    await act(async () => replay?.click())

    expect(window.innerWidth).toBe(375)
    expect(document.querySelectorAll('[data-slot="sheet-overlay"]')).toHaveLength(1)
    expect(document.querySelector('[data-mobile-more-sheet]')).toBe(exitingMoreContent)
    expect(document.querySelector('[data-testid="active"]')?.textContent).toBe('none')

    await act(async () => {
      exitingMoreContent.remove()
      exitingMoreOverlay.remove()
    })
    await settle()

    expect(document.querySelectorAll('[data-slot="sheet-overlay"]')).toHaveLength(1)
    expect(Array.from(document.querySelectorAll('[data-slot="sheet-content"]'))
      .some((sheet) => sheet.textContent?.includes('Más opciones'))).toBe(false)
  })

  it('starts mobile replay after a zero-duration Más Sheet exit at 375px', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 375 })
    mobileViewport = true
    mockGetTourProgress.mockResolvedValue({
      ok: true,
      data: [{ key: 'dashboard_intro', version: 1, status: 'completed', lastStep: 1 }],
    })
    mockLoadTourDefinition.mockResolvedValue({
      ...definition,
      steps: definition.steps.map((step) => ({ ...step, targetId: 'nav-mobile-more' })),
    })
    await renderProvider({ withMobileMore: true })
    const mobileMore = document.querySelector<HTMLElement>('[data-tour-id="nav-mobile-more"]')
    vi.spyOn(mobileMore!, 'getBoundingClientRect').mockReturnValue(new DOMRect(20, 30, 100, 40))

    await click('Más')
    await click('Ayuda y recorridos')
    const help = document.querySelector('[aria-label="Recorridos disponibles"]') as HTMLElement
    const replay = Array.from(help.querySelectorAll('button'))
      .find((button) => button.textContent === 'Repetir recorrido')
    await act(async () => replay?.click())
    await settle()

    expect(window.innerWidth).toBe(375)
    expect(document.querySelectorAll('[data-slot="sheet-overlay"]')).toHaveLength(1)
    expect(Array.from(document.querySelectorAll('[data-slot="sheet-content"]'))
      .some((sheet) => sheet.textContent?.includes('Más opciones'))).toBe(false)
  })

  it('keeps a mounted lower-priority prompt hidden until the tour closes', async () => {
    await renderProvider({ withPromptSurface: true })
    const prompt = container.querySelector('[data-interruptive-surface]') as HTMLElement

    await click('Iniciar recorrido')

    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
    expect(getComputedStyle(prompt).display).toBe('none')

    await click('Omitir recorrido')

    expect(getComputedStyle(prompt).display).not.toBe('none')
  })

  it('ignores a superseded definition load through the generation guard', async () => {
    let resolveFirst!: (value: TourDefinition) => void
    const first = new Promise<TourDefinition>((resolve) => { resolveFirst = resolve })
    mockLoadTourDefinition
      .mockReturnValueOnce(first)
      .mockResolvedValueOnce(definition)
    await renderProvider()

    await click('Iniciar recorrido')
    await click('Repetir recorrido')
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Primer paso')

    await act(async () => resolveFirst({
      ...definition,
      steps: definition.steps.map((item) => ({ ...item, title: 'Carga obsoleta' })),
    }))
    await settle()

    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Primer paso')
    expect(document.querySelector('[role="dialog"]')?.textContent).not.toContain('Carga obsoleta')
  })

  it.each([
    ['the rollout flag turns off', { toursEnabled: false }],
    ['the authenticated role changes', { role: 'admin' as const }],
    ['onboarding becomes incomplete', { onboardingCompleted: false }],
  ])('invalidates a pending start when %s', async (_label, override) => {
    let resolveDefinition!: (value: TourDefinition) => void
    mockLoadTourDefinition.mockReturnValue(new Promise<TourDefinition>((resolve) => {
      resolveDefinition = resolve
    }))
    await renderProvider()
    await click('Iniciar recorrido')

    await renderProvider(override)
    await act(async () => resolveDefinition(definition))
    await settle()

    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(document.querySelector('[data-tour-highlight]')).toBeNull()
    expect(document.querySelector('[data-testid="active"]')?.textContent).toBe('none')
  })

  it.each([
    ['the rollout flag turns off', { toursEnabled: false }],
    ['the authenticated role changes', { role: 'admin' as const }],
    ['onboarding becomes incomplete', { onboardingCompleted: false }],
  ])('closes an active session when %s', async (_label, override) => {
    await renderProvider()
    await click('Iniciar recorrido')
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()

    await renderProvider(override)

    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(document.querySelector('[data-tour-highlight]')).toBeNull()
    expect(document.querySelector('[data-testid="active"]')?.textContent).toBe('none')
  })

  it('closes a mobile tour and cleans active resources when its target is removed', async () => {
    mobileViewport = true
    const removeEventListener = vi.spyOn(window, 'removeEventListener')
    const resizeDisconnect = vi.spyOn(globalThis.ResizeObserver.prototype, 'disconnect')
    const mutationDisconnect = vi.spyOn(globalThis.MutationObserver.prototype, 'disconnect')
    await renderProvider()
    await click('Iniciar recorrido')
    expect(document.querySelector('[data-slot="sheet-overlay"]')).not.toBeNull()
    vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(42)
    const cancelAnimationFrame = vi.spyOn(window, 'cancelAnimationFrame')
    window.dispatchEvent(new Event('resize'))

    target.remove()
    await settle()

    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(document.querySelector('[data-slot="sheet-overlay"]')).toBeNull()
    expect(document.querySelector('[data-tour-highlight]')).toBeNull()
    expect(resizeDisconnect).toHaveBeenCalled()
    expect(mutationDisconnect).toHaveBeenCalled()
    expect(cancelAnimationFrame).toHaveBeenCalledTimes(1)
    expect(cancelAnimationFrame).toHaveBeenCalledWith(expect.any(Number))
    expect(removeEventListener).toHaveBeenCalledWith('resize', expect.any(Function))
    expect(removeEventListener).toHaveBeenCalledWith('scroll', expect.any(Function), true)
  })

  it('fails open without a mobile overlay when target measurement throws', async () => {
    mobileViewport = true
    vi.mocked(target.getBoundingClientRect).mockImplementation(() => {
      throw new Error('measurement failed')
    })
    await renderProvider()

    await click('Iniciar recorrido')
    await settle()

    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(document.querySelector('[data-slot="sheet-overlay"]')).toBeNull()
    expect(document.querySelector('[data-tour-highlight]')).toBeNull()
  })

  it('fails open and removes the mobile overlay when ResizeObserver setup throws', async () => {
    mobileViewport = true
    vi.stubGlobal('ResizeObserver', vi.fn(function BrokenResizeObserver() {
      throw new Error('resize observer unavailable')
    }))
    await renderProvider()

    await click('Iniciar recorrido')
    await settle()

    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(document.querySelector('[data-slot="sheet-overlay"]')).toBeNull()
    expect(document.querySelector('[data-tour-highlight]')).toBeNull()
  })

  it('does not advertise unknown state after a progress read failure but still permits explicit replay', async () => {
    mockGetTourProgress.mockResolvedValue({ ok: false, error: 'offline' })
    await renderProvider()

    expect(document.querySelector('[data-testid="available"]')?.textContent).toBe('')
    await click('Repetir recorrido')
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Primer paso')
  })
})
