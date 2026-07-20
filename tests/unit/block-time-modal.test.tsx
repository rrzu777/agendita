import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterAll, beforeAll, beforeEach, describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

const mockCreateTimeBlock = vi.hoisted(() => vi.fn())
const mockCreateTimeBlockSeries = vi.hoisted(() => vi.fn())
const mockRefresh = vi.hoisted(() => vi.fn())

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mockRefresh }),
}))

vi.mock('@/server/actions/time-blocks', () => ({
  createTimeBlock: mockCreateTimeBlock,
  createTimeBlockSeries: mockCreateTimeBlockSeries,
  deleteTimeBlock: vi.fn(),
}))

import { BlockTimeModal } from '@/components/dashboard/block-time-modal'

describe('BlockTimeModal', () => {
  beforeAll(() => {
    ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  })

  afterAll(() => {
    delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT
  })

  beforeEach(() => {
    mockCreateTimeBlock.mockReset()
    mockCreateTimeBlockSeries.mockReset()
    mockRefresh.mockReset()
  })

  it('renderiza el botón para crear un bloqueo', () => {
    const html = renderToStaticMarkup(
      <BlockTimeModal defaultDate="2026-06-01" timezone="America/Santiago" />,
    )
    expect(html).toContain('Bloquear horario')
  })

  it('cierra el modal y muestra feedback cuando crea un bloqueo simple', async () => {
    mockCreateTimeBlock.mockResolvedValue({ ok: true, data: { id: 'block-1' } })
    const { container, unmount } = await renderBlockTimeModal()

    await clickButton(container, 'Bloquear horario')
    expect(document.body.textContent).toContain('Bloquear horario')

    await clickButton(document.body, 'Bloquear')
    await flushPromises()

    expect(mockCreateTimeBlock).toHaveBeenCalledTimes(1)
    expect(mockRefresh).toHaveBeenCalledTimes(1)
    expect(document.body.textContent).not.toContain('Crea un bloqueo para que los clientes no puedan reservar')
    expect(container.textContent).toContain('Bloqueo creado')

    await unmount()
  })

  it('NO cierra el modal y muestra el mensaje cuando la serie requiere confirmación', async () => {
    mockCreateTimeBlockSeries.mockResolvedValue({
      ok: true,
      data: {
        requiresConfirmation: true,
        message: 'El bloqueo recurrente se solapa con reservas existentes en 1 día(s): 2026-06-01. Además, con este bloqueo "MANICURA" no cabría en ningún día.',
      },
    })
    const { unmount } = await renderBlockTimeModal()

    await clickButton(document.body, 'Bloquear horario')
    await changeCheckbox(document.body, 'recurring', true)
    await clickButton(document.body, 'Lun')
    await clickButton(document.body, 'Bloquear')
    await flushPromises()

    expect(mockCreateTimeBlockSeries).toHaveBeenCalledTimes(1)
    expect(mockCreateTimeBlockSeries.mock.calls[0][0].confirmed).toBe(false)
    expect(mockRefresh).not.toHaveBeenCalled()
    // El modal sigue abierto mostrando el detalle del conflicto
    expect(document.body.textContent).toContain('se solapa con reservas existentes en 1 día(s)')
    expect(document.body.textContent).toContain('"MANICURA" no cabría en ningún día')

    await unmount()
  })

  it('envía confirmed=true cuando la casilla de confirmación está marcada', async () => {
    mockCreateTimeBlockSeries.mockResolvedValue({ ok: true, data: { series: { id: 'series-1' }, overlappingDates: [] } })
    const { unmount } = await renderBlockTimeModal()

    await clickButton(document.body, 'Bloquear horario')
    await changeCheckbox(document.body, 'recurring', true)
    await clickButton(document.body, 'Lun')
    await changeCheckbox(document.body, 'confirm-overlap', true)
    await clickButton(document.body, 'Bloquear')
    await flushPromises()

    expect(mockCreateTimeBlockSeries).toHaveBeenCalledTimes(1)
    expect(mockCreateTimeBlockSeries.mock.calls[0][0].confirmed).toBe(true)

    await unmount()
  })

  it('cierra el modal y muestra snack-bar cuando crea una serie con solapes', async () => {
    mockCreateTimeBlockSeries.mockResolvedValue({
      ok: true,
      data: {
        series: { id: 'series-1' },
        overlappingDates: ['2026-06-01'],
      },
    })
    const { container, unmount } = await renderBlockTimeModal()

    await clickButton(container, 'Bloquear horario')
    await changeCheckbox(document.body, 'recurring', true)
    await clickButton(document.body, 'Lun')
    await clickButton(document.body, 'Bloquear')
    await flushPromises()

    expect(mockCreateTimeBlockSeries).toHaveBeenCalledTimes(1)
    expect(document.body.textContent).not.toContain('Crea un bloqueo para que los clientes no puedan reservar')
    expect(container.textContent).toContain('Serie creada')
    expect(container.textContent).toContain('se solapan con reservas existentes')

    await unmount()
  })
})

async function renderBlockTimeModal() {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)

  await act(async () => {
    root.render(<BlockTimeModal defaultDate="2026-06-01" timezone="America/Santiago" />)
  })

  return {
    container,
    unmount: async () => {
      await act(async () => root.unmount())
      container.remove()
    },
  }
}

async function clickButton(root: ParentNode, name: string) {
  const button = Array.from(root.querySelectorAll('button')).find((el) => el.textContent?.trim() === name)
  if (!button) throw new Error(`Button not found: ${name}`)

  await act(async () => {
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  })
}

async function changeCheckbox(root: ParentNode, id: string, checked: boolean) {
  const checkbox = root.querySelector<HTMLInputElement>(`#${id}`)
  if (!checkbox) throw new Error(`Checkbox not found: ${id}`)

  if (checkbox.checked === checked) return

  await act(async () => {
    checkbox.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  })
}

async function flushPromises() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}
