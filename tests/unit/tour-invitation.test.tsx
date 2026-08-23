import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DashboardTourContext, type DashboardTourContextValue } from '@/components/dashboard/tours/tour-context'
import { TourInvitation } from '@/components/dashboard/tours/tour-invitation'

describe('TourInvitation', () => {
  let container: HTMLDivElement
  let root: Root

  const start = vi.fn<DashboardTourContextValue['start']>()
  const dismiss = vi.fn<DashboardTourContextValue['dismiss']>()
  const offer = vi.fn<DashboardTourContextValue['offer']>()

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    start.mockResolvedValue(undefined)
    dismiss.mockResolvedValue(undefined)
    offer.mockResolvedValue(undefined)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    vi.clearAllMocks()
  })

  async function render(available: DashboardTourContextValue['available']) {
    await act(async () => root.render(
      <DashboardTourContext.Provider value={{
        available,
        helpTours: [],
        active: null,
        start,
        next: vi.fn(),
        previous: vi.fn(),
        dismiss,
        offer,
        closeReplay: vi.fn(),
      }}>
        <TourInvitation />
      </DashboardTourContext.Provider>,
    ))
  }

  it('stays hidden while the intro is not eligible', async () => {
    await render([])

    expect(container.textContent).not.toContain('Conoce Agendita en 2 minutos')
    expect(offer).not.toHaveBeenCalled()
  })

  it('offers an eligible intro without opening its tour', async () => {
    await render(['dashboard_intro'])

    expect(container.textContent).toContain('Conoce Agendita en 2 minutos')
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(offer).toHaveBeenCalledWith('dashboard_intro')
  })

  it('starts or dismisses only from the explicit card actions', async () => {
    await render(['dashboard_intro'])
    const buttons = Array.from(container.querySelectorAll('button'))

    await act(async () => buttons.find((button) => button.textContent === 'Iniciar recorrido')?.click())
    await act(async () => buttons.find((button) => button.textContent === 'Ahora no')?.click())

    expect(start).toHaveBeenCalledWith('dashboard_intro')
    expect(dismiss).toHaveBeenCalledWith('dashboard_intro')
  })
})
