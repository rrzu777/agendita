import { act, useState, type ComponentProps } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TourSurface } from '@/components/dashboard/tours/tour-surface'
import type { TourStep, TourViewport } from '@/components/dashboard/tours/tour-types'

const step = {
  id: 'navigation',
  targetKind: 'static',
  targetId: 'nav-desktop',
  title: 'Navega por tu negocio',
  body: 'Encuentra aquí todas las secciones.',
  viewports: ['desktop', 'mobile'],
  waitMs: 50,
} satisfies TourStep

function buttonNamed(name: string) {
  const button = Array.from(document.querySelectorAll('button')).find((candidate) => (
    candidate.getAttribute('aria-label') === name || candidate.textContent?.trim() === name
  ))
  if (!button) throw new Error(`Button not found: ${name}`)
  return button as HTMLButtonElement
}

describe('TourSurface', () => {
  let container: HTMLDivElement
  let root: Root
  let target: HTMLButtonElement
  let rect: DOMRect

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    target = document.createElement('button')
    target.dataset.tourId = 'nav-desktop'
    document.body.appendChild(target)
    rect = new DOMRect(40, 60, 120, 44)
    vi.spyOn(target, 'getBoundingClientRect').mockImplementation(() => rect)
    target.scrollIntoView = vi.fn()
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }))
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    document.body.replaceChildren()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  async function renderSurface(
    viewport: TourViewport,
    overrides: Partial<ComponentProps<typeof TourSurface>> = {},
  ) {
    await act(async () => root.render(
      <TourSurface
        step={step}
        stepNumber={1}
        totalSteps={2}
        viewport={viewport}
        target={target}
        canGoPrevious={false}
        isLastStep={false}
        onPrevious={vi.fn()}
        onNext={vi.fn()}
        onDismiss={vi.fn()}
        {...overrides}
      />,
    ))
  }

  it('anchors an associated desktop dialog to the center of a fixed target proxy', async () => {
    await renderSurface('desktop')

    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')
    const anchor = document.querySelector<HTMLElement>('[data-tour-anchor]')
    const title = document.getElementById(dialog?.getAttribute('aria-labelledby') ?? '')
    const description = document.getElementById(dialog?.getAttribute('aria-describedby') ?? '')

    expect(dialog?.dataset.slot).toBe('popover-content')
    expect(dialog?.className).toContain('pointer-events-auto')
    expect(anchor?.className).toContain('fixed')
    expect(anchor?.style.left).toBe('100px')
    expect(anchor?.style.top).toBe('82px')
    expect(anchor?.style.width).toBe('1px')
    expect(anchor?.style.height).toBe('1px')
    expect(title?.textContent).toBe(step.title)
    expect(description?.textContent).toBe(step.body)
    expect(document.querySelector('[data-tour-highlight]')?.className).toContain('pointer-events-none')
    expect(document.querySelector('[aria-label="Paso 1 de 2"]')).not.toBeNull()
    expect(buttonNamed('Atrás').disabled).toBe(true)
    expect(buttonNamed('Siguiente').disabled).toBe(false)
    expect(buttonNamed('Omitir recorrido').disabled).toBe(false)
  })

  it('uses a bottom Sheet with safe-area padding on mobile', async () => {
    await renderSurface('mobile')

    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')
    expect(dialog?.dataset.slot).toBe('sheet-content')
    expect(dialog?.dataset.side).toBe('bottom')
    expect(dialog?.className).toContain('pb-[env(safe-area-inset-bottom)]')
    expect(document.querySelector('[data-slot="sheet-overlay"]')).not.toBeNull()
    expect(document.getElementById(dialog?.getAttribute('aria-labelledby') ?? '')?.textContent).toBe(step.title)
    expect(document.getElementById(dialog?.getAttribute('aria-describedby') ?? '')?.textContent).toBe(step.body)
  })

  it('turns Escape into an explicit dismissal confirmation', async () => {
    const onDismiss = vi.fn()
    await renderSurface('desktop', { onDismiss })

    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))

    expect(onDismiss).not.toHaveBeenCalled()
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('¿Omitir este recorrido?')

    await act(async () => buttonNamed('Omitir recorrido').click())
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('restores focus to the launcher when dismissal unmounts the surface', async () => {
    const launcher = document.createElement('button')
    launcher.textContent = 'Iniciar recorrido'
    document.body.appendChild(launcher)
    launcher.focus()

    function Harness() {
      const [open, setOpen] = useState(true)
      return open
        ? (
            <TourSurface
              step={step}
              stepNumber={1}
              totalSteps={1}
              viewport="desktop"
              target={target}
              restoreFocusTo={launcher}
              canGoPrevious={false}
              isLastStep
              onPrevious={vi.fn()}
              onNext={vi.fn()}
              onDismiss={() => setOpen(false)}
            />
          )
        : null
    }

    await act(async () => root.render(<Harness />))
    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    await act(async () => buttonNamed('Omitir recorrido').click())

    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(document.activeElement).toBe(launcher)
  })

  it('disables animated scrolling when reduced motion is requested', async () => {
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }))

    await renderSurface('desktop')

    expect(target.scrollIntoView).toHaveBeenCalledWith({
      behavior: 'auto',
      block: 'center',
      inline: 'nearest',
    })
  })

  it.each(['desktop', 'mobile'] as const)('disables tour surface motion on %s', async (viewport) => {
    await renderSurface(viewport)

    const dialogClasses = document.querySelector<HTMLElement>('[role="dialog"]')?.className.split(' ') ?? []
    expect(dialogClasses).toEqual(expect.arrayContaining([
      'motion-reduce:animate-none',
      'motion-reduce:duration-0',
      'motion-reduce:transition-none',
    ]))

    if (viewport === 'mobile') {
      const overlayClasses = document.querySelector<HTMLElement>('[data-slot="sheet-overlay"]')?.className.split(' ') ?? []
      expect(overlayClasses).toEqual(expect.arrayContaining([
        'motion-reduce:animate-none',
        'motion-reduce:duration-0',
        'motion-reduce:transition-none',
      ]))
    }
  })

  it('throttles rect updates and removes active layout listeners on unmount', async () => {
    const queued: FrameRequestCallback[] = []
    const requestAnimationFrame = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      queued.push(callback)
      return queued.length
    })
    const cancelAnimationFrame = vi.spyOn(window, 'cancelAnimationFrame')
    const removeEventListener = vi.spyOn(window, 'removeEventListener')
    await renderSurface('desktop')
    rect = new DOMRect(80, 90, 140, 50)

    window.dispatchEvent(new Event('resize'))
    window.dispatchEvent(new Event('resize'))
    expect(requestAnimationFrame).toHaveBeenCalledTimes(1)
    await act(async () => queued[0]?.(1))

    expect(document.querySelector<HTMLElement>('[data-tour-anchor]')?.style.left).toBe('150px')
    window.dispatchEvent(new Event('resize'))
    await act(async () => root.unmount())

    expect(cancelAnimationFrame).toHaveBeenCalled()
    expect(removeEventListener).toHaveBeenCalledWith('resize', expect.any(Function))
    expect(removeEventListener).toHaveBeenCalledWith('scroll', expect.any(Function), true)
  })

  it('uses the new target rectangle when the active step changes', async () => {
    await renderSurface('desktop')
    const nextTarget = document.createElement('button')
    nextTarget.dataset.tourId = 'bookings-new'
    nextTarget.scrollIntoView = vi.fn()
    vi.spyOn(nextTarget, 'getBoundingClientRect').mockReturnValue(new DOMRect(220, 120, 90, 44))
    document.body.appendChild(nextTarget)

    await renderSurface('desktop', {
      target: nextTarget,
      step: { ...step, id: 'new-booking', targetId: 'bookings-new' },
    })

    expect(document.querySelector<HTMLElement>('[data-tour-anchor]')?.style.left).toBe('265px')
  })

  it('recomputes the active target rectangle after a sibling layout mutation', async () => {
    await renderSurface('desktop')
    rect = new DOMRect(180, 140, 160, 44)

    await act(async () => {
      const sibling = document.createElement('div')
      document.body.insertBefore(sibling, target)
      await new Promise((resolve) => window.requestAnimationFrame(resolve))
    })

    expect(document.querySelector<HTMLElement>('[data-tour-anchor]')?.style.left).toBe('260px')
    expect(document.querySelector<HTMLElement>('[data-tour-anchor]')?.style.top).toBe('162px')
  })

  it('recomputes the active target rectangle after a sibling class changes layout', async () => {
    const sibling = document.createElement('aside')
    document.body.insertBefore(sibling, target)
    await renderSurface('desktop')
    rect = new DOMRect(200, 150, 160, 44)

    await act(async () => {
      sibling.classList.add('collapsed')
      await new Promise((resolve) => window.requestAnimationFrame(resolve))
    })

    expect(document.querySelector<HTMLElement>('[data-tour-anchor]')?.style.left).toBe('280px')
    expect(document.querySelector<HTMLElement>('[data-tour-anchor]')?.style.top).toBe('172px')
  })

  it('ignores child-list mutations owned by the tour portal and surface', async () => {
    await renderSurface('desktop')
    const requestAnimationFrame = vi.spyOn(window, 'requestAnimationFrame')
    const highlight = document.querySelector<HTMLElement>('[data-tour-highlight]')

    await act(async () => {
      highlight?.appendChild(document.createElement('span'))
      const overlay = document.createElement('div')
      overlay.dataset.slot = 'sheet-overlay'
      const focusGuard = document.createElement('span')
      focusGuard.dataset.radixFocusGuard = ''
      document.body.append(overlay, focusGuard)
      await Promise.resolve()
    })

    expect(requestAnimationFrame).not.toHaveBeenCalled()
  })

  it('fails open when the active target becomes hidden', async () => {
    const onFailure = vi.fn()
    await renderSurface('desktop', { onFailure })
    vi.mocked(target.getBoundingClientRect).mockReturnValue(new DOMRect(0, 0, 0, 0))
    target.hidden = true

    await act(async () => {
      window.dispatchEvent(new Event('resize'))
      await new Promise((resolve) => window.requestAnimationFrame(resolve))
    })

    expect(onFailure).toHaveBeenCalledTimes(1)
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(document.querySelector('[data-tour-highlight]')).toBeNull()
  })

  it('announces a dirty-form pause and prevents advancing', async () => {
    const onNext = vi.fn()
    await renderSurface('desktop', { paused: true, onNext })

    expect(document.querySelector('[role="dialog"]')?.textContent)
      .toContain('Termina o descarta tus cambios para continuar')
    expect(buttonNamed('Siguiente').disabled).toBe(true)
    await act(async () => buttonNamed('Siguiente').click())
    expect(onNext).not.toHaveBeenCalled()
  })
})
