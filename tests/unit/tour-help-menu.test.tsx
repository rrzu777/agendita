import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DashboardTourContext, type DashboardTourContextValue } from '@/components/dashboard/tours/tour-context'
import { TourHelpMenu } from '@/components/dashboard/tours/tour-help-menu'

async function waitForElementRemoval(selector: string) {
  await act(async () => {
    if (!document.querySelector(selector)) return
    await new Promise<void>((resolve) => {
      const observer = new MutationObserver(() => {
        if (document.querySelector(selector)) return
        observer.disconnect()
        resolve()
      })
      observer.observe(document.body, { childList: true, subtree: true })
    })
  })
}

describe('TourHelpMenu', () => {
  let container: HTMLDivElement
  let root: Root
  const start = vi.fn<DashboardTourContextValue['start']>()

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    start.mockResolvedValue(undefined)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    vi.clearAllMocks()
  })

  async function render(
    helpTours: DashboardTourContextValue['helpTours'],
    options: { compact?: boolean; onAcceptedStart?: () => void } = {},
  ) {
    await act(async () => root.render(
      <DashboardTourContext.Provider value={{
        available: [],
        helpTours,
        active: null,
        start,
        next: vi.fn(),
        previous: vi.fn(),
        dismiss: vi.fn(),
        offer: vi.fn(),
        closeReplay: vi.fn(),
      }}>
        <TourHelpMenu {...options} />
      </DashboardTourContext.Provider>,
    ))
  }

  it('lists only provider-compatible tours and marks completed tours', async () => {
    await render([
      { key: 'dashboard_intro', title: 'Primeros pasos en Agendita', status: 'completed' },
    ])

    await act(async () => container.querySelector('button')?.click())

    expect(container.textContent).toContain('Primeros pasos en Agendita')
    expect(container.textContent).toContain('Completado')
    expect(container.textContent).not.toContain('Reservas')
  })

  it('always starts a Help replay without resetting stored completion', async () => {
    await render([
      { key: 'dashboard_intro', title: 'Primeros pasos en Agendita', status: 'completed' },
    ])
    await act(async () => container.querySelector('button')?.click())
    const replay = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent === 'Repetir recorrido')

    await act(async () => replay?.click())

    expect(start).toHaveBeenCalledWith('dashboard_intro', { replay: true })
  })

  it('starts an available Help tour as a persisted session', async () => {
    await render([
      { key: 'bookings', title: 'Gestiona tus reservas', status: 'available' },
    ])
    await act(async () => container.querySelector('button')?.click())
    const startAvailable = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent === 'Iniciar recorrido')

    await act(async () => startAvailable?.click())

    expect(start).toHaveBeenCalledWith('bookings')
  })

  it('notifies its host before replay starts', async () => {
    const onAcceptedStart = vi.fn()
    await render([
      { key: 'dashboard_intro', title: 'Primeros pasos en Agendita', status: 'completed' },
    ], { onAcceptedStart })
    await act(async () => container.querySelector('button')?.click())
    const replay = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent === 'Repetir recorrido')

    await act(async () => replay?.click())

    expect(onAcceptedStart).toHaveBeenCalledBefore(start)
  })

  it('uses a focused portal popover from the compact sidebar trigger', async () => {
    await render([
      { key: 'dashboard_intro', title: 'Primeros pasos en Agendita', status: 'completed' },
    ], { compact: true })
    const trigger = container.querySelector('button') as HTMLButtonElement
    trigger.focus()

    await act(async () => trigger.click())

    const menu = document.querySelector('[data-slot="popover-content"]') as HTMLElement
    expect(menu).not.toBeNull()
    expect(menu.closest('aside')).toBeNull()
    expect(container.querySelector('[aria-label="Recorridos disponibles"]')).toBeNull()

    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    await waitForElementRemoval('[data-slot="popover-content"]')

    expect(document.activeElement).toBe(trigger)
  })
})
