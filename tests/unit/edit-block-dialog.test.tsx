import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

const mockUpdateTimeBlock = vi.hoisted(() => vi.fn())
const mockDeleteTimeBlock = vi.hoisted(() => vi.fn())

vi.mock('@/server/actions/time-blocks', () => ({
  updateTimeBlock: mockUpdateTimeBlock,
  deleteTimeBlock: mockDeleteTimeBlock,
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}))

import { EditBlockDialog } from '@/components/dashboard/edit-block-dialog'

const block = {
  id: 'block-1',
  startDateTime: '2026-06-01T17:00:00.000Z',
  endDateTime: '2026-06-01T18:00:00.000Z',
  reason: 'Almuerzo',
}

describe('EditBlockDialog', () => {
  let root: Root | null = null

  afterEach(async () => {
    if (root) {
      await act(async () => root?.unmount())
      root = null
    }
    document.body.replaceChildren()
    mockUpdateTimeBlock.mockReset()
    mockDeleteTimeBlock.mockReset()
  })

  it('renderiza sin lanzar errores', () => {
    expect(() =>
      renderToStaticMarkup(
        <EditBlockDialog block={block} timezone="America/Santiago" open={false} onOpenChange={() => {}} />,
      ),
    ).not.toThrow()
  })

  it('mueve la fecha fin junto con la fecha inicio mientras no se edite explícitamente', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)

    await act(async () => {
      root?.render(<EditBlockDialog block={block} timezone="America/Santiago" open={true} onOpenChange={() => {}} />)
    })

    const startDate = document.body.querySelector<HTMLInputElement>('#block-date')!
    const endDate = document.body.querySelector<HTMLInputElement>('#block-end-date')!
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    await act(async () => {
      setter.call(startDate, '2026-06-02')
      startDate.dispatchEvent(new Event('input', { bubbles: true }))
      startDate.dispatchEvent(new Event('change', { bubbles: true }))
    })

    expect(endDate.value).toBe('2026-06-02')
  })

  it('deja de sincronizar la fecha fin después de editarla explícitamente', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)

    await act(async () => {
      root?.render(<EditBlockDialog block={block} timezone="America/Santiago" open={true} onOpenChange={() => {}} />)
    })

    const startDate = document.body.querySelector<HTMLInputElement>('#block-date')!
    const endDate = document.body.querySelector<HTMLInputElement>('#block-end-date')!
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    await act(async () => {
      setter.call(endDate, '2026-06-03')
      endDate.dispatchEvent(new Event('input', { bubbles: true }))
      endDate.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await act(async () => {
      setter.call(startDate, '2026-06-02')
      startDate.dispatchEvent(new Event('input', { bubbles: true }))
      startDate.dispatchEvent(new Event('change', { bubbles: true }))
    })

    expect(endDate.value).toBe('2026-06-03')
  })
})
