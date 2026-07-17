import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('@/server/actions/customers', () => ({ setCustomerMarketingOptOut: vi.fn() }))

import { MarketingOptOutToggle } from '@/app/dashboard/customers/[id]/marketing-optout-toggle'

describe('MarketingOptOutToggle', () => {
  it('cuando acepta campañas: switch prendido, sin fecha de baja', () => {
    const html = renderToStaticMarkup(
      <MarketingOptOutToggle customerId="c1" marketingOptOutAt={null} />,
    )
    expect(html).toContain('Acepta campañas')
    expect(html).toContain('data-state="checked"')
    expect(html).not.toContain('Se dio de baja')
  })

  it('cuando está opt-out: switch apagado + fecha de baja', () => {
    const html = renderToStaticMarkup(
      <MarketingOptOutToggle customerId="c1" marketingOptOutAt={new Date('2026-07-16T12:00:00Z')} />,
    )
    expect(html).toContain('data-state="unchecked"')
    expect(html).toContain('Se dio de baja')
  })
})
