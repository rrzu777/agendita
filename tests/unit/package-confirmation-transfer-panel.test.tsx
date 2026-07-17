import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))
vi.mock('@/server/actions/packages-checkout', () => ({ declarePackageTransfer: vi.fn() }))

import { PackageTransferPanel } from '@/app/paquetes/confirmation/transfer-panel'

const bank = {
  accountHolder: 'Estudio Luna', rut: '11.111.111-1', bankName: 'Banco Estado',
  accountType: 'corriente', accountNumber: '123456', email: null, instructions: null, holdHours: 48,
  requireProof: false,
}

describe('PackageTransferPanel', () => {
  it('muestra los datos bancarios, el monto y el botón Ya transferí', () => {
    const html = renderToStaticMarkup(
      <PackageTransferPanel transferInfo={bank} amount={50000} currency="CLP" purchaseId="pp1" />,
    )
    expect(html).toContain('Estudio Luna')
    expect(html).toContain('123456')
    expect(html).toContain('Ya transferí')
  })
})
