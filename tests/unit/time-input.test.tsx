import { describe, it, expect, vi, afterEach } from 'vitest'
import { act } from 'react'
import type { ComponentProps } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { TimeInput } from '@/components/ui/time-input'

let root: Root | null = null

describe('TimeInput', () => {
  afterEach(() => {
    if (root) {
      act(() => root?.unmount())
      root = null
    }
    document.body.replaceChildren()
  })

  it('allows selecting quick minutes from the desktop popover', async () => {
    const onChange = vi.fn()
    const container = renderTimeInput({
      id: 'schedule-start',
      value: '09:00',
      onChange,
      ariaLabel: 'Hora inicio',
    })

    expect(container.querySelector('input[type="time"]')).toBeNull()
    expect(container.querySelector('select')).toBeNull()

    await clickButton(document.body, '09:00')
    await clickButton(document.body, '45')
    await clickButton(document.body, 'Aplicar')

    expect(onChange).toHaveBeenCalledWith('09:45')
  })

  it('keeps the selected minutes when the hour changes', async () => {
    const onChange = vi.fn()
    renderTimeInput({
      id: 'booking-time',
      value: '13:30',
      onChange,
      ariaLabel: 'Hora',
    })

    await clickButton(document.body, '13:30')
    await clickButton(document.body, '16')
    await clickButton(document.body, 'Aplicar')

    expect(onChange).toHaveBeenCalledWith('16:30')
  })

  it('applies the latest desktop hour and minute together', async () => {
    const onChange = vi.fn()
    renderTimeInput({
      id: 'booking-time',
      value: '13:30',
      onChange,
      ariaLabel: 'Hora',
    })

    await clickButton(document.body, '13:30')
    await clickButton(document.body, '16')
    await clickButton(document.body, '45')
    await clickButton(document.body, 'Aplicar')

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith('16:45')
  })

  it('normalizes hour values without a leading zero', () => {
    const onChange = vi.fn()
    renderTimeInput({
      id: 'schedule-start',
      value: '9:05',
      onChange,
      ariaLabel: 'Hora inicio',
    })

    expect(document.body.textContent).toContain('09:05')
  })

  it('keeps an exact minute chip when the current value is not a common increment', async () => {
    renderTimeInput({
      id: 'schedule-start',
      value: '10:07',
      onChange: vi.fn(),
      ariaLabel: 'Hora inicio',
    })

    await clickButton(document.body, '10:07')

    expect(findButton(document.body, '07')).not.toBeNull()
  })
})

function renderTimeInput(props: ComponentProps<typeof TimeInput>) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)

  act(() => {
    root?.render(<TimeInput {...props} />)
  })

  return container
}

function findButton(rootNode: ParentNode, name: string) {
  return Array.from(rootNode.querySelectorAll('button')).find((button) => button.textContent?.trim() === name) ?? null
}

async function clickButton(rootNode: ParentNode, name: string) {
  const button = findButton(rootNode, name)
  if (!button) throw new Error(`Button not found: ${name}`)
  await act(async () => {
    button.click()
    await Promise.resolve()
  })
}
