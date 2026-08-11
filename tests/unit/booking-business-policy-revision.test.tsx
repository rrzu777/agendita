import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

const captureWizardProps = vi.hoisted(() => vi.fn())

vi.mock('@/components/booking/wizard', () => ({
  BookingWizard: (props: Record<string, unknown>) => {
    captureWizardProps(props)
    return <div>booking wizard</div>
  },
}))

import { BookingBusinessPage } from '@/components/booking/booking-business-page'

describe('booking policy consent revision', () => {
  it('passes the deterministic revision of the displayed policy into the wizard', () => {
    const business = {
      id: 'biz-1',
      name: 'Mimos',
      slug: 'mimos',
      addressText: null,
      whatsapp: null,
      timezone: 'America/Santiago',
      currency: 'CLP',
      category: 'other',
      cancellationPolicy: 'Condiciones originales',
      selfServiceCutoffHours: 24,
      manualHoldHours: 24,
      services: [],
      professionals: [],
    } as never

    renderToStaticMarkup(
      <BookingBusinessPage business={business} profileHref="/b/mimos" session={null} />,
    )

    expect(captureWizardProps).toHaveBeenCalledWith(expect.objectContaining({
      cancellationPolicyRevision: 'f0992f452f8046a66991a7d0cc83eea4c21f7bfc30049726882c42bca36466d8',
    }))
  })
})
