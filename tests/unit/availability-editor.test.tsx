import { describe, it, expect, vi, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

const mockUpdateAvailabilityRule = vi.fn()

vi.mock('@/server/actions/availability', () => ({
  updateAvailabilityRule: (...args: unknown[]) => mockUpdateAvailabilityRule(...args),
}))

import { AvailabilityEditor } from '@/components/dashboard/availability-editor'

const mondayRule = {
  id: 'rule-monday',
  dayOfWeek: 1,
  startTime: '09:00',
  endTime: '18:00',
  isActive: true,
}

describe('AvailabilityEditor', () => {
  let root: Root | null = null

  afterEach(() => {
    if (root) {
      act(() => root?.unmount())
      root = null
    }
    document.body.replaceChildren()
    mockUpdateAvailabilityRule.mockReset()
  })

  it('updates weekly availability minutes through the shared time input', async () => {
    mockUpdateAvailabilityRule.mockResolvedValue(undefined)
    const container = renderEditor()
    const minuteSelect = container.querySelector<HTMLSelectElement>('select[aria-label="Lunes inicio minutos"]')

    await act(async () => {
      minuteSelect!.value = '45'
      minuteSelect!.dispatchEvent(new Event('change', { bubbles: true }))
    })

    expect(mockUpdateAvailabilityRule).toHaveBeenCalledWith('rule-monday', {
      startTime: '09:45',
      endTime: '18:00',
      isActive: true,
    })
  })

  it('does not save when selecting the current minute value again', async () => {
    mockUpdateAvailabilityRule.mockResolvedValue(undefined)
    const container = renderEditor()
    const minuteSelect = container.querySelector<HTMLSelectElement>('select[aria-label="Lunes inicio minutos"]')

    await act(async () => {
      minuteSelect!.value = '00'
      minuteSelect!.dispatchEvent(new Event('change', { bubbles: true }))
    })

    expect(mockUpdateAvailabilityRule).not.toHaveBeenCalled()
  })

  it('rejects an inverted time range without calling the server', async () => {
    mockUpdateAvailabilityRule.mockResolvedValue(undefined)
    const container = renderEditor()
    const hourSelect = container.querySelector<HTMLSelectElement>('select[aria-label="Lunes inicio hora"]')

    await act(async () => {
      hourSelect!.value = '19'
      hourSelect!.dispatchEvent(new Event('change', { bubbles: true }))
    })

    expect(mockUpdateAvailabilityRule).not.toHaveBeenCalled()
    expect(container.textContent).toContain('La hora de inicio debe ser anterior a la de término')
  })

  it('clears the error and persists once the range becomes valid', async () => {
    mockUpdateAvailabilityRule.mockResolvedValue(undefined)
    const container = renderEditor()
    const startHour = container.querySelector<HTMLSelectElement>('select[aria-label="Lunes inicio hora"]')

    await act(async () => {
      startHour!.value = '19'
      startHour!.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(mockUpdateAvailabilityRule).not.toHaveBeenCalled()

    const endHour = container.querySelector<HTMLSelectElement>('select[aria-label="Lunes fin hora"]')
    await act(async () => {
      endHour!.value = '21'
      endHour!.dispatchEvent(new Event('change', { bubbles: true }))
    })

    expect(mockUpdateAvailabilityRule).toHaveBeenCalledWith('rule-monday', {
      startTime: '19:00',
      endTime: '21:00',
      isActive: true,
    })
    expect(container.textContent).not.toContain('La hora de inicio debe ser anterior a la de término')
  })

  function renderEditor() {
    const container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    act(() => {
      root?.render(<AvailabilityEditor rules={[mondayRule]} />)
    })

    return container
  }
})
