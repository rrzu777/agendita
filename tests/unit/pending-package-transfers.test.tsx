import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('@/server/actions/bank-transfer-verify', () => ({
  confirmPackageTransfer: vi.fn(), rejectPackageTransfer: vi.fn(),
}))

import { PendingPackageTransfers } from '@/components/packages/pending-package-transfers'

const item = {
  paymentId: 'pay1',
  purchaseId: 'purch1',
  customerName: 'Ana',
  productName: 'Pack 5 sesiones',
  amount: 50000,
}

describe('PendingPackageTransfers', () => {
  it('con un item: muestra clienta, producto, Confirmar y Rechazar', () => {
    const html = renderToStaticMarkup(<PendingPackageTransfers items={[item]} currency="CLP" />)
    expect(html).toContain('Ana')
    expect(html).toContain('Pack 5 sesiones')
    expect(html).toContain('Confirmar')
    expect(html).toContain('Rechazar')
  })

  it('sin items: no renderiza nada', () => {
    const html = renderToStaticMarkup(<PendingPackageTransfers items={[]} currency="CLP" />)
    expect(html).not.toContain('por verificar')
  })
})
