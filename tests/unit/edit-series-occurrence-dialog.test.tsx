import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterAll, beforeAll, beforeEach, describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

const mockOverrideSeriesOccurrence = vi.hoisted(() => vi.fn())
const mockUpdateTimeBlockSeries = vi.hoisted(() => vi.fn())
const mockRefresh = vi.hoisted(() => vi.fn())

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mockRefresh }) }))

vi.mock('@/server/actions/time-blocks', () => ({
  skipSeriesOccurrence: vi.fn(),
  overrideSeriesOccurrence: mockOverrideSeriesOccurrence,
  updateTimeBlockSeries: mockUpdateTimeBlockSeries,
  deleteTimeBlockSeries: vi.fn(),
}))

import { EditSeriesOccurrenceDialog } from '@/components/dashboard/edit-series-occurrence-dialog'

const block = {
  id: 's1:2026-06-01',
  startDateTime: '2026-06-01T17:00:00.000Z',
  endDateTime: '2026-06-01T18:00:00.000Z',
  reason: 'Almuerzo',
  seriesId: 's1',
  occurrenceDate: '2026-06-01T04:00:00.000Z',
}

describe('EditSeriesOccurrenceDialog', () => {
  beforeAll(() => {
    ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  })

  afterAll(() => {
    delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT
  })

  beforeEach(() => {
    mockOverrideSeriesOccurrence.mockReset()
    mockUpdateTimeBlockSeries.mockReset()
    mockRefresh.mockReset()
  })

  it('renderiza sin lanzar', () => {
    expect(() =>
      renderToStaticMarkup(<EditSeriesOccurrenceDialog block={block} timezone="America/Santiago" open={true} onOpenChange={() => {}} />),
    ).not.toThrow()
  })

  it('muestra el aviso de conflicto y reintenta con confirmed=true al confirmar (solo este día)', async () => {
    mockOverrideSeriesOccurrence
      .mockResolvedValueOnce({
        ok: true,
        data: {
          requiresConfirmation: true,
          message: 'El bloqueo se solapa con reservas existentes. Confirma si deseas guardarlo de todas formas (no se cancelarán las reservas existentes).',
        },
      })
      .mockResolvedValueOnce({ ok: true, data: undefined })
    const { unmount } = await renderDialog()

    await clickButton(document.body, 'Guardar cambios')
    await clickButton(document.body, 'Solo este día')
    await flushPromises()

    expect(mockOverrideSeriesOccurrence).toHaveBeenCalledTimes(1)
    expect(mockOverrideSeriesOccurrence.mock.calls[0][2].confirmed).toBe(false)
    expect(mockRefresh).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('se solapa con reservas existentes')

    await clickButton(document.body, 'Guardar de todas formas')
    await flushPromises()

    expect(mockOverrideSeriesOccurrence).toHaveBeenCalledTimes(2)
    expect(mockOverrideSeriesOccurrence.mock.calls[1][2].confirmed).toBe(true)
    expect(mockRefresh).toHaveBeenCalledTimes(1)

    await unmount()
  })

  it('muestra el aviso de conflicto y reintenta con confirmed=true al confirmar (toda la serie)', async () => {
    mockUpdateTimeBlockSeries
      .mockResolvedValueOnce({
        ok: true,
        data: {
          requiresConfirmation: true,
          message: 'El nuevo horario de la serie se solapa con reservas existentes en 2 día(s): 2026-06-01, 2026-06-02. Confirma si deseas guardarlo de todas formas (no se cancelarán las reservas existentes).',
        },
      })
      .mockResolvedValueOnce({ ok: true, data: { series: { id: 's2' } } })
    const { unmount } = await renderDialog()

    await clickButton(document.body, 'Guardar cambios')
    await clickButton(document.body, 'Toda la serie')
    await flushPromises()

    expect(mockUpdateTimeBlockSeries).toHaveBeenCalledTimes(1)
    expect(mockUpdateTimeBlockSeries.mock.calls[0][1].confirmed).toBe(false)
    expect(document.body.textContent).toContain('2026-06-01, 2026-06-02')

    await clickButton(document.body, 'Guardar de todas formas')
    await flushPromises()

    expect(mockUpdateTimeBlockSeries).toHaveBeenCalledTimes(2)
    expect(mockUpdateTimeBlockSeries.mock.calls[1][1].confirmed).toBe(true)
    expect(mockRefresh).toHaveBeenCalledTimes(1)

    await unmount()
  })

  it('guarda directo y refresca cuando no hay conflicto', async () => {
    mockOverrideSeriesOccurrence.mockResolvedValue({ ok: true, data: undefined })
    const { unmount } = await renderDialog()

    await clickButton(document.body, 'Guardar cambios')
    await clickButton(document.body, 'Solo este día')
    await flushPromises()

    expect(mockOverrideSeriesOccurrence).toHaveBeenCalledTimes(1)
    expect(mockRefresh).toHaveBeenCalledTimes(1)

    await unmount()
  })
})

async function renderDialog() {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)

  await act(async () => {
    root.render(
      <EditSeriesOccurrenceDialog block={block} timezone="America/Santiago" open={true} onOpenChange={() => {}} />,
    )
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

async function flushPromises() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}
