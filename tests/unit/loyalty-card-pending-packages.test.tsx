import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }))

import { LoyaltyCard } from '@/components/loyalty/loyalty-card'
import type { LoyaltyCardData } from '@/lib/loyalty/card-data'

const baseData = {
  config: null, balance: 0, history: [], catalog: [], grants: [], packages: [], referralUrl: null,
  pendingPackages: [],
} as unknown as LoyaltyCardData

describe('LoyaltyCard — paquetes por confirmar', () => {
  it('lista una pending sin declarar con "Te falta transferir" y link de retorno', () => {
    const data = {
      ...baseData,
      pendingPackages: [{ id: 'pp1', productName: 'Pack 5', declared: false, resumeUrl: 'https://biz.agendita.cl/paquetes/confirmation?purchaseId=pp1' }],
    } as unknown as LoyaltyCardData
    const html = renderToStaticMarkup(
      <LoyaltyCard customerName="Ana" business={{ name: 'Biz', logoUrl: null }} data={data} redeemAction={async () => {}} />,
    )
    expect(html).toContain('Pack 5')
    expect(html).toContain('Te falta transferir')
    expect(html).toContain('purchaseId=pp1')
  })

  it('declarada muestra "En verificación"', () => {
    const data = {
      ...baseData,
      pendingPackages: [{ id: 'pp1', productName: 'Pack 5', declared: true, resumeUrl: 'https://x/paquetes/confirmation?purchaseId=pp1' }],
    } as unknown as LoyaltyCardData
    const html = renderToStaticMarkup(
      <LoyaltyCard customerName="Ana" business={{ name: 'Biz', logoUrl: null }} data={data} redeemAction={async () => {}} />,
    )
    expect(html).toContain('En verificación')
  })

  it('sin pendientes no renderiza la sección', () => {
    const html = renderToStaticMarkup(
      <LoyaltyCard customerName="Ana" business={{ name: 'Biz', logoUrl: null }} data={baseData} redeemAction={async () => {}} />,
    )
    expect(html).not.toContain('Paquetes por confirmar')
  })
})
