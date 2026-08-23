import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DashboardTourContext, type DashboardTourContextValue } from '@/components/dashboard/tours/tour-context'
import { TourHelpMenu } from '@/components/dashboard/tours/tour-help-menu'

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

  async function render(helpTours: DashboardTourContextValue['helpTours']) {
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
        <TourHelpMenu />
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
})
