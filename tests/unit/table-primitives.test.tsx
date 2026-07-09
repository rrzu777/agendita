import { renderToStaticMarkup } from 'react-dom/server'
import { describe, it, expect } from 'vitest'
import { Table } from '@/components/ui/table'

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
