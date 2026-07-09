import { describe, expect, it, vi, beforeEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { RedemptionsButton } from '@/app/dashboard/promociones/redemptions-button'

vi.mock('@/server/actions/promotions', () => ({
  getPromotionRedemptions: vi.fn(),
}))

describe('RedemptionsButton', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the trigger without the dialog content (closed by default)', () => {
    const html = renderToStaticMarkup(
      <RedemptionsButton promotionId="promo-1" promotionName="Verano 2026" currency="CLP" />
    )

    expect(html).toContain('Ver canjes')
  })
})
