import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

describe('CSV export form system', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })

  it('uses a named date range with aligned compact controls', async () => {
    const { ExportCSVButton } = await import('@/components/dashboard/export-csv-button')
    await act(async () => root.render(<ExportCSVButton />))

    expect(container.querySelector('fieldset legend')?.textContent).toBe(
      'Rango de fechas para exportar movimientos',
    )

    const from = container.querySelector<HTMLInputElement>('#ledger-export-from')
    const to = container.querySelector<HTMLInputElement>('#ledger-export-to')
    expect(from?.labels?.[0]?.textContent).toContain('Desde')
    expect(to?.labels?.[0]?.textContent).toContain('Hasta')
    expect(from?.getAttribute('data-density')).toBe('compact')
    expect(to?.getAttribute('data-density')).toBe('compact')
    expect(container.querySelector<HTMLButtonElement>('button')?.getAttribute('data-size')).toBe('default')
  })
})
