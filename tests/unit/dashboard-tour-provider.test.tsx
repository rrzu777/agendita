import { act, StrictMode } from 'react'
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
      viewports: ['desktop'],
      waitMs: 20,
    },
    {
      id: 'second',
      targetKind: 'static',
      targetId: 'nav-desktop',
      title: 'Segundo paso',
      body: 'Segunda explicación.',
      viewports: ['desktop'],
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

describe('DashboardTourProvider', () => {
  let container: HTMLDivElement
  let root: Root
  let target: HTMLButtonElement

  beforeEach(() => {
    pathname = '/dashboard'
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    target = document.createElement('button')
    target.dataset.tourId = 'nav-desktop'
    target.scrollIntoView = vi.fn()
    vi.spyOn(target, 'getBoundingClientRect').mockReturnValue(new DOMRect(20, 30, 100, 40))
    document.body.appendChild(target)
    vi.stubGlobal('matchMedia', vi.fn().mockImplementation((query: string) => ({
      matches: false,
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

  async function renderProvider({ dirty = false }: { dirty?: boolean } = {}) {
    await act(async () => root.render(
      <UnsavedChangesProvider>
        <DashboardTourProvider
          role="owner"
          onboardingCompleted
          toursEnabled
        >
          <DirtyRegistration dirty={dirty} />
          <Controls />
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

  it('does not advertise unknown state after a progress read failure but still permits explicit replay', async () => {
    mockGetTourProgress.mockResolvedValue({ ok: false, error: 'offline' })
    await renderProvider()

    expect(document.querySelector('[data-testid="available"]')?.textContent).toBe('')
    await click('Repetir recorrido')
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Primer paso')
  })
})
