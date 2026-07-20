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
    mockUpdateAvailabilityRule.mockResolvedValue({ ok: true, data: null })
    const container = renderEditor()

    await changeTime(container, 'Lunes inicio', { minute: '45' })
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
    await changeTime(container, 'Lunes inicio', { minute: '45' })
    expect(findSaveButton(container)).toBeTruthy()

    await changeTime(container, 'Lunes inicio', { minute: '00' })
    expect(findSaveButton(container)).toBeUndefined()
    expect(mockUpdateAvailabilityRule).not.toHaveBeenCalled()
  })

  it('disables saving an inverted time range and shows the validation error', async () => {
    const container = renderEditor()
    await changeTime(container, 'Lunes inicio', { hour: '19' })

    expect(container.textContent).toContain('La hora de inicio debe ser anterior a la de término')
    const saveButton = findSaveButton(container)
    expect(saveButton?.disabled).toBe(true)
    expect(mockUpdateAvailabilityRule).not.toHaveBeenCalled()
  })

  it('clears the error and saves once the range becomes valid', async () => {
    mockUpdateAvailabilityRule.mockResolvedValue({ ok: true, data: null })
    const container = renderEditor()

    await changeTime(container, 'Lunes inicio', { hour: '19' })
    await changeTime(container, 'Lunes fin', { hour: '21' })
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

  it('shows the ActionResult error verbatim and keeps the pending changes', async () => {
    mockUpdateAvailabilityRule.mockResolvedValue({ ok: false, error: 'Regla no encontrada' })
    const container = renderEditor()

    await changeTime(container, 'Lunes inicio', { minute: '45' })
    const saveButton = findSaveButton(container)
    await act(async () => {
      saveButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(container.textContent).toContain('Regla no encontrada')
    // El botón sigue disponible para reintentar y el borrador no se pierde
    expect(findSaveButton(container)).toBeTruthy()
    expect(container.querySelector<HTMLButtonElement>('button[aria-label="Lunes inicio"]')?.textContent).toContain('09:45')
  })

  it('keeps the pending changes and shows a generic error on a transport failure', async () => {
    mockUpdateAvailabilityRule.mockRejectedValue(new Error('boom'))
    const container = renderEditor()

    await changeTime(container, 'Lunes inicio', { minute: '45' })
    const saveButton = findSaveButton(container)
    await act(async () => {
      saveButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(container.textContent).toContain('No pudimos guardar los cambios')
    // El botón sigue disponible para reintentar y el borrador no se pierde
    expect(findSaveButton(container)).toBeTruthy()
    expect(container.querySelector<HTMLButtonElement>('button[aria-label="Lunes inicio"]')?.textContent).toContain('09:45')
  })

  it('persists the toggle immediately using the saved times, discarding drafts', async () => {
    mockUpdateAvailabilityRule.mockResolvedValue({ ok: true, data: null })
    const container = renderEditor()

    await changeTime(container, 'Lunes inicio', { minute: '45' })
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

  async function changeTime(
    container: HTMLElement,
    label: string,
    value: { hour?: string; minute?: string },
  ) {
    const trigger = container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)
    await act(async () => {
      trigger!.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }))
      trigger!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
    })
    if (value.hour) await clickButton(document.body, value.hour)
    if (value.minute) await clickLastButton(document.body, value.minute)
    await clickButton(document.body, 'Aplicar')
    // Al cerrar, el FocusScope de Radix devuelve el foco al trigger dentro de un
    // setTimeout(0). Si ese timer dispara con el SIGUIENTE popover ya abierto, el
    // focusin cae "fuera" de ese popover y lo descarta (onInteractOutside -> onDismiss),
    // haciendo flaky la segunda apertura. Drenamos el timer acá, dentro de act.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }

  function findButtons(rootNode: ParentNode, name: string) {
    return Array.from(rootNode.querySelectorAll('button')).filter((button) => button.textContent?.trim() === name)
  }

  async function clickButton(rootNode: ParentNode, name: string) {
    const button = findButtons(rootNode, name)[0]
    if (!button) throw new Error(`Button not found: ${name}`)
    await act(async () => {
      button.click()
      await Promise.resolve()
    })
  }

  async function clickLastButton(rootNode: ParentNode, name: string) {
    const button = findButtons(rootNode, name).at(-1)
    if (!button) throw new Error(`Button not found: ${name}`)
    await act(async () => {
      button.click()
      await Promise.resolve()
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
