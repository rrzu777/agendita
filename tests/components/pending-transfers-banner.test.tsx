import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { PendingTransfersBanner } from '@/components/dashboard/pending-transfers-banner'

describe('PendingTransfersBanner', () => {
  it('renders count + link when > 0', () => {
    const html = renderToStaticMarkup(<PendingTransfersBanner count={3} />)
    expect(html).toContain('3')
    expect(html).toContain('/dashboard/bookings')
  })
  it('renders nothing when 0', () => {
    expect(renderToStaticMarkup(<PendingTransfersBanner count={0} />)).toBe('')
  })
})
