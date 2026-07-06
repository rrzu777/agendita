import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { LoyaltyCard } from '@/components/loyalty/loyalty-card'

const baseData = {
  config: { isActive: true, programName: 'Club Mimos', pointsLabel: 'mimos', cardMessage: null },
  balance: 120,
  history: [],
  catalog: [{ id: 'p1', name: 'Descuento 10%', pointsCost: 100 }],
  grants: [],
  packages: [],
  referralUrl: null,
}

describe('LoyaltyCard', () => {
  it('muestra balance, catálogo canjeable y botón habilitado si alcanza', () => {
    const html = renderToStaticMarkup(
      <LoyaltyCard customerName="Ana Pérez" business={{ name: 'Mimos', logoUrl: null }} data={baseData as never} redeemAction={vi.fn() as never} />,
    )
    expect(html).toContain('120')
    expect(html).toContain('Descuento 10%')
    expect(html).toContain('Canjear')
    expect(html).toContain('Hola, Ana')
  })

  it('programa pausado: aviso y sin catálogo', () => {
    const data = { ...baseData, config: { ...baseData.config, isActive: false }, catalog: [] }
    const html = renderToStaticMarkup(
      <LoyaltyCard customerName="Ana" business={{ name: 'Mimos', logoUrl: null }} data={data as never} redeemAction={vi.fn() as never} />,
    )
    expect(html).toContain('pausado')
  })
})
