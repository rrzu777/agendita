import type React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, it, expect } from 'vitest'
import { Table } from '@/components/ui/table'
import { StatusBadge } from '@/components/ui/status-badge'
import { TruncatedCell } from '@/components/ui/truncated-cell'

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

describe('TruncatedCell', () => {
  function render(node: React.ReactNode) {
    return renderToStaticMarkup(<table><tbody><tr>{node}</tr></tbody></table>)
  }

  it('renders primary text with a truncate wrapper and a title for the full text', () => {
    const html = render(<TruncatedCell primary="Manicura semipermanente + diseño" />)
    expect(html).toContain('truncate')
    expect(html).toContain('title="Manicura semipermanente + diseño"')
    expect(html).toContain('Manicura semipermanente + diseño')
  })

  it('renders the secondary line when provided', () => {
    const html = render(<TruncatedCell primary="Servicio" secondary="#4738" />)
    expect(html).toContain('#4738')
  })

  it('omits the secondary line when not provided', () => {
    const html = render(<TruncatedCell primary="Servicio" />)
    expect(html).not.toContain('text-muted-foreground')
  })
})
