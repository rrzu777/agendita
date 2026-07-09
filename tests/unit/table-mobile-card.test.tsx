import { renderToStaticMarkup } from 'react-dom/server'
import { describe, it, expect } from 'vitest'
import { TableMobileCard } from '@/components/ui/table-mobile-card'

describe('TableMobileCard', () => {
  it('renders title, subtitle, rows, badge and actions', () => {
    const html = renderToStaticMarkup(
      <TableMobileCard
        title="Manicura semipermanente"
        subtitle="#4738"
        badge={<span>Confirmada</span>}
        rows={[{ label: 'Fecha', value: '11 jul' }, { label: 'Pago', value: '$15.000' }]}
        actions={<button>Completar</button>}
      />,
    )
    expect(html).toContain('Manicura semipermanente')
    expect(html).toContain('#4738')
    expect(html).toContain('Confirmada')
    expect(html).toContain('Fecha')
    expect(html).toContain('$15.000')
    expect(html).toContain('Completar')
  })

  it('omits subtitle, badge and actions when not provided', () => {
    const html = renderToStaticMarkup(<TableMobileCard title="Solo título" rows={[]} />)
    expect(html).toContain('Solo título')
  })
})
