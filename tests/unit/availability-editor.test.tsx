import { describe, it, expect, vi, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { clickButton } from '../helpers/react-dom'

const mockSetWeeklyScheduleDay = vi.fn()
const mockResetProfessionalSchedule = vi.fn()

vi.mock('@/server/actions/availability', () => ({
  setWeeklyScheduleDay: (...args: unknown[]) => mockSetWeeklyScheduleDay(...args),
  resetProfessionalSchedule: (...args: unknown[]) => mockResetProfessionalSchedule(...args),
}))

import { AvailabilityEditor } from '@/components/dashboard/availability-editor'

const monday = { dayOfWeek: 1, startTime: '09:00', endTime: '18:00', isActive: true }
const sunday = { dayOfWeek: 0, startTime: '09:00', endTime: '18:00', isActive: false }

describe('AvailabilityEditor', () => {
  let root: Root | null = null

  afterEach(() => {
    if (root) {
      act(() => root?.unmount())
      root = null
    }
    document.body.replaceChildren()
    mockSetWeeklyScheduleDay.mockReset()
    mockResetProfessionalSchedule.mockReset()
  })

  it('does not persist time changes until the save button is clicked', async () => {
    mockSetWeeklyScheduleDay.mockResolvedValue({ ok: true, data: null })
    const container = renderEditor()

    await changeTime(container, 'Lunes inicio', { minute: '45' })
    expect(mockSetWeeklyScheduleDay).not.toHaveBeenCalled()

    const saveButton = findSaveButton(container)
    expect(saveButton).toBeTruthy()
    await act(async () => {
      saveButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(mockSetWeeklyScheduleDay).toHaveBeenCalledWith(null, {
      dayOfWeek: 1,
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
    expect(mockSetWeeklyScheduleDay).not.toHaveBeenCalled()
  })

  it('disables saving an inverted time range and shows the validation error', async () => {
    const container = renderEditor()
    await changeTime(container, 'Lunes inicio', { hour: '19' })

    expect(container.textContent).toContain('La hora de inicio debe ser anterior a la de término')
    const saveButton = findSaveButton(container)
    expect(saveButton?.disabled).toBe(true)
    expect(mockSetWeeklyScheduleDay).not.toHaveBeenCalled()
  })

  it('clears the error and saves once the range becomes valid', async () => {
    mockSetWeeklyScheduleDay.mockResolvedValue({ ok: true, data: null })
    const container = renderEditor()

    await changeTime(container, 'Lunes inicio', { hour: '19' })
    await changeTime(container, 'Lunes fin', { hour: '21' })
    expect(container.textContent).not.toContain('La hora de inicio debe ser anterior a la de término')

    const saveButton = findSaveButton(container)
    await act(async () => {
      saveButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(mockSetWeeklyScheduleDay).toHaveBeenCalledWith(null, {
      dayOfWeek: 1,
      startTime: '19:00',
      endTime: '21:00',
      isActive: true,
    })
  })

  it('shows the ActionResult error verbatim and keeps the pending changes', async () => {
    mockSetWeeklyScheduleDay.mockResolvedValue({ ok: false, error: 'Regla no encontrada' })
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
    mockSetWeeklyScheduleDay.mockRejectedValue(new Error('boom'))
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
    mockSetWeeklyScheduleDay.mockResolvedValue({ ok: true, data: null })
    const container = renderEditor()

    await changeTime(container, 'Lunes inicio', { minute: '45' })
    const toggle = container.querySelector<HTMLButtonElement>('[role="switch"]')!
    await act(async () => {
      toggle.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(mockSetWeeklyScheduleDay).toHaveBeenCalledTimes(1)
    expect(mockSetWeeklyScheduleDay).toHaveBeenCalledWith(null, {
      dayOfWeek: 1,
      startTime: '09:00',
      endTime: '18:00',
      isActive: false,
    })
    expect(findSaveButton(container)).toBeUndefined()
  })

  /**
   * Un día cerrado no muestra horas, así que el switch es el único camino para abrirlo
   * — y con el salón es el único camino que existe para abrir un día que **no tiene
   * fila**, que era justamente lo que la pantalla no podía hacer antes.
   */
  it('abre un día cerrado con las horas de relleno que muestra', async () => {
    mockSetWeeklyScheduleDay.mockResolvedValue({ ok: true, data: null })
    const container = renderEditor({ days: [sunday] })

    const toggle = container.querySelector<HTMLButtonElement>('[role="switch"]')!
    await act(async () => {
      toggle.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(mockSetWeeklyScheduleDay).toHaveBeenCalledWith(null, {
      dayOfWeek: 0,
      startTime: '09:00',
      endTime: '18:00',
      isActive: true,
    })
  })

  it('manda el id de la persona cuando se está editando su horario', async () => {
    mockSetWeeklyScheduleDay.mockResolvedValue({ ok: true, data: null })
    const container = renderEditor({ professionalId: 'juan', inherited: true, professionalName: 'Juan' })

    await changeTime(container, 'Lunes inicio', { minute: '45' })
    await act(async () => {
      findSaveButton(container)!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(mockSetWeeklyScheduleDay).toHaveBeenCalledWith('juan', expect.objectContaining({ dayOfWeek: 1 }))
  })

  describe('la herencia del horario del salón', () => {
    it('con el salón seleccionado no habla de heredar ni ofrece soltar nada', () => {
      const container = renderEditor()

      expect(container.textContent).not.toContain('horario del salón')
      expect(findButtonContaining(container, 'Volver al horario del salón')).toBeUndefined()
    })

    it('avisa que la persona sigue el horario del salón, y de que el primer cambio lo corta', () => {
      const container = renderEditor({ professionalId: 'juan', inherited: true, professionalName: 'Juan' })

      expect(container.textContent).toContain('Sigue el horario del salón')
      expect(container.textContent).toContain('Juan')
      expect(findButtonContaining(container, 'Volver al horario del salón')).toBeUndefined()
    })

    /**
     * Guardar un día materializa la semana ENTERA (ver `setWeekday`), así que a partir
     * de ese click la persona ya no hereda. El aviso tiene que caerse solo: dejarlo
     * puesto es exactamente la confusión que el aviso existe para evitar.
     */
    it('deja de avisar que hereda apenas se guarda un día', async () => {
      mockSetWeeklyScheduleDay.mockResolvedValue({ ok: true, data: null })
      const container = renderEditor({ professionalId: 'juan', inherited: true, professionalName: 'Juan' })

      await changeTime(container, 'Lunes inicio', { minute: '45' })
      await act(async () => {
        findSaveButton(container)!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      })

      expect(container.textContent).not.toContain('Sigue el horario del salón')
      expect(findButtonContaining(container, 'Volver al horario del salón')).toBeTruthy()
    })

    it('un guardado fallido no la da por dueña de su horario', async () => {
      mockSetWeeklyScheduleDay.mockResolvedValue({ ok: false, error: 'Demasiadas solicitudes' })
      const container = renderEditor({ professionalId: 'juan', inherited: true, professionalName: 'Juan' })

      await changeTime(container, 'Lunes inicio', { minute: '45' })
      await act(async () => {
        findSaveButton(container)!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      })

      expect(container.textContent).toContain('Sigue el horario del salón')
    })

    /**
     * Las horas que la pantalla tiene en la mano son las que se acaban de borrar. Si no
     * pintara las que devuelve la action, mostraría un horario que ya no existe en
     * ningún lado — y el próximo guardado lo volvería a escribir como propio.
     */
    it('al soltar el horario propio pinta el del salón que vuelve a regir', async () => {
      mockResetProfessionalSchedule.mockResolvedValue({
        ok: true,
        data: { days: [{ dayOfWeek: 1, startTime: '07:00', endTime: '12:00', isActive: true }] },
      })
      const container = renderEditor({
        days: [{ dayOfWeek: 1, startTime: '15:00', endTime: '20:00', isActive: true }],
        professionalId: 'juan',
        inherited: false,
        professionalName: 'Juan',
      })

      await act(async () => {
        findButtonContaining(container, 'Volver al horario del salón')!
          .dispatchEvent(new MouseEvent('click', { bubbles: true }))
      })

      expect(mockResetProfessionalSchedule).toHaveBeenCalledWith('juan')
      expect(container.querySelector<HTMLButtonElement>('button[aria-label="Lunes inicio"]')?.textContent).toContain('07:00')
      expect(container.textContent).toContain('Sigue el horario del salón')
    })

    it('si soltar falla, muestra el error y no cambia el horario que se ve', async () => {
      mockResetProfessionalSchedule.mockResolvedValue({ ok: false, error: 'No autorizado' })
      const container = renderEditor({
        days: [{ dayOfWeek: 1, startTime: '15:00', endTime: '20:00', isActive: true }],
        professionalId: 'juan',
        inherited: false,
        professionalName: 'Juan',
      })

      await act(async () => {
        findButtonContaining(container, 'Volver al horario del salón')!
          .dispatchEvent(new MouseEvent('click', { bubbles: true }))
      })

      expect(container.textContent).toContain('No autorizado')
      expect(container.querySelector<HTMLButtonElement>('button[aria-label="Lunes inicio"]')?.textContent).toContain('15:00')
    })
  })

  function findButtonContaining(container: HTMLElement, text: string) {
    return Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes(text))
  }

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
    if (value.minute) await clickButton(document.body, value.minute, { occurrence: 'last' })
    await clickButton(document.body, 'Aplicar')
    // Al cerrar, el FocusScope de Radix devuelve el foco al trigger dentro de un
    // setTimeout(0). Si ese timer dispara con el SIGUIENTE popover ya abierto, el
    // focusin cae "fuera" de ese popover y lo descarta (onInteractOutside -> onDismiss),
    // haciendo flaky la segunda apertura. Drenamos el timer acá, dentro de act.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }

  function findSaveButton(container: HTMLElement) {
    return findButtonContaining(container, 'Guardar')
  }

  function renderEditor(props: Partial<React.ComponentProps<typeof AvailabilityEditor>> = {}) {
    const container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    act(() => {
      root?.render(
        <AvailabilityEditor
          days={[monday]}
          professionalId={null}
          inherited={false}
          professionalName={null}
          {...props}
        />,
      )
    })

    return container
  }
})
