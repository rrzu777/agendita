import { renderToStaticMarkup } from 'react-dom/server'
import { describe, it, expect } from 'vitest'
import { Table } from '@/components/ui/table'
import { StatusBadge } from '@/components/ui/status-badge'

describe('Table fixed', () => {
  it('applies table-fixed when fixed is set', () => {
    const html = renderToStaticMarkup(<Table fixed><tbody /></Table>)
    expect(html).toContain('table-fixed')
  })

  it('does not apply table-fixed by default', () => {
    const html = renderToStaticMarkup(<Table><tbody /></Table>)
    expect(html).not.toContain('table-fixed')
  })
})

describe('StatusBadge', () => {
  it('renders the mapped label and color class for a known status', () => {
    const html = renderToStaticMarkup(<StatusBadge status="confirmed" />)
    expect(html).toContain('Confirmada')
    expect(html).toContain('text-green-800')
  })

  it('lets the caller override the label', () => {
    const html = renderToStaticMarkup(<StatusBadge status="pending_payment" label="Pendiente" />)
    expect(html).toContain('Pendiente')
    expect(html).not.toContain('Pendiente de pago')
  })

  it('falls back to the raw status when unknown', () => {
    const html = renderToStaticMarkup(<StatusBadge status="weird_state" />)
    expect(html).toContain('weird_state')
  })
})
