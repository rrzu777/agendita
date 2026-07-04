import { describe, it, expect, vi, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { TimeInput } from '@/components/ui/time-input'

describe('TimeInput', () => {
  let root: Root | null = null

  afterEach(() => {
    if (root) {
      act(() => root?.unmount())
      root = null
    }
    document.body.replaceChildren()
  })

  it('allows selecting minutes without relying on the native time picker', () => {
    const onChange = vi.fn()
    const container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    act(() => {
      root?.render(
        <TimeInput
          id="schedule-start"
          value="09:00"
          onChange={onChange}
          ariaLabel="Hora inicio"
        />,
      )
    })

    const minuteSelect = container.querySelector<HTMLSelectElement>('select[aria-label="Hora inicio minutos"]')
    expect(minuteSelect).not.toBeNull()
    expect(container.querySelector('input[type="time"]')).toBeNull()

    act(() => {
      minuteSelect!.value = '45'
      minuteSelect!.dispatchEvent(new Event('change', { bubbles: true }))
    })

    expect(onChange).toHaveBeenCalledWith('09:45')
  })

  it('keeps the selected minutes when the hour changes', () => {
    const onChange = vi.fn()
    const container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    act(() => {
      root?.render(
        <TimeInput
          id="booking-time"
          value="13:30"
          onChange={onChange}
          ariaLabel="Hora"
        />,
      )
    })

    const hourSelect = container.querySelector<HTMLSelectElement>('select[aria-label="Hora hora"]')
    expect(hourSelect).not.toBeNull()

    act(() => {
      hourSelect!.value = '16'
      hourSelect!.dispatchEvent(new Event('change', { bubbles: true }))
    })

    expect(onChange).toHaveBeenCalledWith('16:30')
  })

  it('normalizes hour values without a leading zero', () => {
    const onChange = vi.fn()
    const container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    act(() => {
      root?.render(
        <TimeInput
          id="schedule-start"
          value="9:05"
          onChange={onChange}
          ariaLabel="Hora inicio"
        />,
      )
    })

    expect(container.querySelector<HTMLSelectElement>('select[aria-label="Hora inicio hora"]')?.value).toBe('09')
    expect(container.querySelector<HTMLSelectElement>('select[aria-label="Hora inicio minutos"]')?.value).toBe('05')
  })
})
