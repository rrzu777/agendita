import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { StepTime } from '@/components/booking/step-time'
import type { BookingData } from '@/components/booking/wizard'

vi.mock('@/server/actions/availability', () => ({
  getAvailableTimeSlots: vi.fn(),
}))

import { getAvailableTimeSlots } from '@/server/actions/availability'

const data = {
  date: new Date('2026-07-09T16:00:00Z'),
  serviceId: 'svc-1',
  serviceName: 'Esmaltado',
} as unknown as BookingData

describe('StepTime states', () => {
  let root: Root | null = null
  let container: HTMLDivElement

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
  })

  afterEach(() => {
    if (root) {
      act(() => root?.unmount())
      root = null
    }
    document.body.replaceChildren()
    vi.clearAllMocks()
  })

  async function render() {
    root = createRoot(container)
    await act(async () => {
      root?.render(<StepTime businessId="biz-1" data={data} onSelect={() => {}} onBack={() => {}} />)
    })
  }

  it('shows a retryable error state, not "No hay horarios", when the fetch fails', async () => {
    vi.mocked(getAvailableTimeSlots).mockRejectedValue(new Error('Demasiadas solicitudes. Intenta de nuevo en unos minutos.'))
    await render()
    expect(container.textContent).toContain('No pudimos cargar los horarios')
    expect(container.textContent).toContain('Demasiadas solicitudes')
    expect(container.textContent).not.toContain('No hay horarios disponibles')
    const retry = Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes('Reintentar'))
    expect(retry).toBeTruthy()
  })

  it('retry button re-fetches and can recover', async () => {
    vi.mocked(getAvailableTimeSlots)
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce([{ start: new Date('2026-07-09T13:00:00Z'), end: new Date('2026-07-09T14:30:00Z') }])
    await render()
    const retry = Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes('Reintentar'))!
    await act(async () => {
      retry.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(vi.mocked(getAvailableTimeSlots)).toHaveBeenCalledTimes(2)
    expect(container.textContent).toContain('Elige una hora')
  })

  it('empty state explains the minimum lead time', async () => {
    vi.mocked(getAvailableTimeSlots).mockResolvedValue([])
    await render()
    expect(container.textContent).toContain('No hay horarios disponibles')
    expect(container.textContent).toContain('2 horas de anticipación')
  })

  it('slot grid shows the lead time hint', async () => {
    vi.mocked(getAvailableTimeSlots).mockResolvedValue([
      { start: new Date('2026-07-09T13:00:00Z'), end: new Date('2026-07-09T14:30:00Z') },
    ])
    await render()
    expect(container.textContent).toContain('Elige una hora')
    expect(container.textContent).toContain('2 horas de anticipación')
  })
})
