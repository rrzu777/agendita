import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { RewardFields } from '@/components/dashboard/reward-fields'

const base = { rewardType: 'percentage' as const, rewardValue: '20', maxDiscount: '', appliesToAll: true, serviceIds: [] as string[] }

describe('RewardFields', () => {
  it('percentage muestra input de % y descuento máximo', () => {
    const html = renderToStaticMarkup(<RewardFields value={base} onChange={() => {}} services={[]} currency="CLP" />)
    expect(html).toContain('Porcentaje')
    expect(html).toContain('Descuento máximo')
  })
  it('free_service oculta el input de valor', () => {
    const html = renderToStaticMarkup(<RewardFields value={{ ...base, rewardType: 'free_service' }} onChange={() => {}} services={[]} currency="CLP" />)
    expect(html).not.toContain('Porcentaje (1–100)')
  })
  it('con appliesToAll false renderiza los chips de servicios', () => {
    const html = renderToStaticMarkup(
      <RewardFields
        value={{ ...base, appliesToAll: false, serviceIds: [] }}
        onChange={() => {}}
        services={[{ id: 's1', name: 'Corte de pelo' }]}
        currency="CLP"
      />,
    )
    expect(html).toContain('Corte de pelo')
  })
})
