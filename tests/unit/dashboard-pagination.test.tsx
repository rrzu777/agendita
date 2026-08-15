import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { DashboardPagination, getSingleSearchParam } from '@/components/dashboard/dashboard-pagination'

describe('DashboardPagination', () => {
  it('keeps cursor navigation in the URL without turning a server list into a client-side history cache', () => {
    const html = renderToStaticMarkup(
      <DashboardPagination nextCursor="booking-50" label="Ver 50 reservas más" />,
    )

    expect(html).toContain('href="?cursor=booking-50"')
    expect(html).toContain('Ver 50 reservas más')
  })

  it('does not render a dead navigation control on the final page', () => {
    const html = renderToStaticMarkup(<DashboardPagination nextCursor={null} label="Ver más" />)

    expect(html).toBe('')
  })

  it('preserves the independent history cursor when paging an operational queue', () => {
    const html = renderToStaticMarkup(
      <DashboardPagination
        nextCursor="transfer-50"
        label="Ver más transferencias"
        searchParam="transferCursor"
        preserve={{ cursor: 'booking-50' }}
      />,
    )

    expect(html).toContain('href="?cursor=booking-50&amp;transferCursor=transfer-50"')
  })
})

describe('getSingleSearchParam', () => {
  it('rejects repeated query values instead of passing an array to a cursor query', () => {
    expect(getSingleSearchParam(['first', 'second'])).toBeUndefined()
    expect(getSingleSearchParam('booking-50')).toBe('booking-50')
  })
})
