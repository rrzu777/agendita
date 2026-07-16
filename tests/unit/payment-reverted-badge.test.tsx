import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { PaymentRevertedBadge } from '@/components/dashboard/payment-reverted-badge'

describe('PaymentRevertedBadge', () => {
  it('renderiza el badge con paymentStatus refunded', () => {
    const html = renderToStaticMarkup(<PaymentRevertedBadge paymentStatus="refunded" />)
    expect(html).toContain('Pago revertido')
  })
  it.each(['unpaid', 'deposit_paid', 'fully_paid', 'failed'])('NO renderiza con %s', (s) => {
    const html = renderToStaticMarkup(<PaymentRevertedBadge paymentStatus={s} />)
    expect(html).toBe('')
  })
})
