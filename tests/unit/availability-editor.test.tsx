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

  it('does not persist time changes until the save button is clicked', async () => {
    mockUpdateAvailabilityRule.mockResolvedValue(undefined)
    const container = renderEditor()

    await changeSelect(container, 'select[aria-label="Lunes inicio minutos"]', '45')
    expect(mockUpdateAvailabilityRule).not.toHaveBeenCalled()

    const saveButton = findSaveButton(container)
    expect(saveButton).toBeTruthy()
    await act(async () => {
      saveButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(mockUpdateAvailabilityRule).toHaveBeenCalledWith('rule-monday', {
      startTime: '09:45',
      endTime: '18:00',
      isActive: true,
    })
    expect(container.textContent).toContain('Guardado')
  })

  it('shows no save button when there are no pending changes', () => {
    const container = renderEditor()
    expect(findSaveButton(container)).toBeUndefined()
  })

  it('hides the save button and feedback again after reverting to the saved value', async () => {
    const container = renderEditor()
    await changeSelect(container, 'select[aria-label="Lunes inicio minutos"]', '45')
    expect(findSaveButton(container)).toBeTruthy()

    await changeSelect(container, 'select[aria-label="Lunes inicio minutos"]', '00')
    expect(findSaveButton(container)).toBeUndefined()
    expect(mockUpdateAvailabilityRule).not.toHaveBeenCalled()
  })

  it('disables saving an inverted time range and shows the validation error', async () => {
    const container = renderEditor()
    await changeSelect(container, 'select[aria-label="Lunes inicio hora"]', '19')

    expect(container.textContent).toContain('La hora de inicio debe ser anterior a la de término')
    const saveButton = findSaveButton(container)
    expect(saveButton?.disabled).toBe(true)
    expect(mockUpdateAvailabilityRule).not.toHaveBeenCalled()
  })

  it('clears the error and saves once the range becomes valid', async () => {
    mockUpdateAvailabilityRule.mockResolvedValue(undefined)
    const container = renderEditor()

    await changeSelect(container, 'select[aria-label="Lunes inicio hora"]', '19')
    await changeSelect(container, 'select[aria-label="Lunes fin hora"]', '21')
    expect(container.textContent).not.toContain('La hora de inicio debe ser anterior a la de término')

    const saveButton = findSaveButton(container)
    await act(async () => {
      saveButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(mockUpdateAvailabilityRule).toHaveBeenCalledWith('rule-monday', {
      startTime: '19:00',
      endTime: '21:00',
      isActive: true,
    })
  })

  it('keeps the pending changes and shows an error when the server fails', async () => {
    mockUpdateAvailabilityRule.mockRejectedValue(new Error('boom'))
    const container = renderEditor()

    await changeSelect(container, 'select[aria-label="Lunes inicio minutos"]', '45')
    const saveButton = findSaveButton(container)
    await act(async () => {
      saveButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(container.textContent).toContain('No pudimos guardar los cambios')
    // El botón sigue disponible para reintentar y el borrador no se pierde
    expect(findSaveButton(container)).toBeTruthy()
    const minuteSelect = container.querySelector<HTMLSelectElement>('select[aria-label="Lunes inicio minutos"]')
    expect(minuteSelect!.value).toBe('45')
  })

  it('persists the toggle immediately using the saved times, discarding drafts', async () => {
    mockUpdateAvailabilityRule.mockResolvedValue(undefined)
    const container = renderEditor()

    await changeSelect(container, 'select[aria-label="Lunes inicio minutos"]', '45')
    const toggle = container.querySelector<HTMLButtonElement>('[role="switch"]')!
    await act(async () => {
      toggle.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(mockUpdateAvailabilityRule).toHaveBeenCalledTimes(1)
    expect(mockUpdateAvailabilityRule).toHaveBeenCalledWith('rule-monday', {
      startTime: '09:00',
      endTime: '18:00',
      isActive: false,
    })
    expect(findSaveButton(container)).toBeUndefined()
  })

  async function changeSelect(container: HTMLElement, selector: string, value: string) {
    const select = container.querySelector<HTMLSelectElement>(selector)
    await act(async () => {
      select!.value = value
      select!.dispatchEvent(new Event('change', { bubbles: true }))
    })
  }

  function findSaveButton(container: HTMLElement) {
    return Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes('Guardar'))
  }

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
