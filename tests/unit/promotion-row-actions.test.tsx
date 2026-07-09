import { renderToStaticMarkup } from 'react-dom/server'
import { describe, it, expect, vi } from 'vitest'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))

import { PromotionRowActions } from '@/app/dashboard/promociones/promotion-row-actions'

function editPromo(overrides: Record<string, unknown> = {}) {
  return {
    id: 'p1',
    name: 'Verano 20%',
    description: 'Descuento de verano',
    code: 'VERANO20',
    rewardType: 'percentage' as const,
    rewardValue: 20,
    maxDiscount: null,
    appliesToAll: true,
    serviceIds: [],
    validFrom: null,
    validUntil: null,
    minSpend: null,
    maxRedemptions: null,
    maxPerCustomer: null,
    redemptionCount: 0,
    isActive: true,
    ...overrides,
  }
}

describe('PromotionRowActions', () => {
  it('shows Editar as primary + kebab trigger for an active promo', () => {
    const html = renderToStaticMarkup(
      <PromotionRowActions promo={editPromo() as never} services={[]} currency="CLP" />,
    )
    expect(html).toContain('Editar')
    expect(html).toContain('Más acciones')
  })

  it('shows Editar as primary + kebab trigger for an inactive promo', () => {
    const html = renderToStaticMarkup(
      <PromotionRowActions promo={editPromo({ isActive: false }) as never} services={[]} currency="CLP" />,
    )
    expect(html).toContain('Editar')
    expect(html).toContain('Más acciones')
  })
})
