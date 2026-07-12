import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { PackageCheckout, PackageTransferInstructions } from '@/components/packages/package-checkout'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }))
vi.mock('@/server/actions/packages-checkout', () => ({
  createPackagePurchase: vi.fn(), initiatePackagePayment: vi.fn(), declarePackageTransfer: vi.fn(),
}))

const product = { id: 'p1', name: 'Pack 5', quantity: 5, bonusQuantity: 0, price: 50000, expiryDays: null, appliesToAll: true, serviceNames: [] }
const prefill = { email: 'c@x.cl', name: 'Ana', phone: '+56 9 1111 2222' }
const transferInfo = {
  accountHolder: 'María P', rut: '1-9', bankName: 'BancoEstado', accountType: 'vista',
  accountNumber: '12345678', email: null, instructions: 'nombre en el asunto', holdHours: 48, requireProof: false,
}

describe('PackageCheckout — método transferencia', () => {
  it('sin transferencia: el form paga directo (botón Pagar)', () => {
    const html = renderToStaticMarkup(
      <PackageCheckout product={product} currency="CLP" prefill={prefill} onCancel={() => {}} transferInfo={null} />,
    )
    expect(html).toContain('Pagar')
    expect(html).not.toContain('Continuar')
  })

  it('con transferencia: el form ofrece Continuar (lleva a elegir método)', () => {
    const html = renderToStaticMarkup(
      <PackageCheckout product={product} currency="CLP" prefill={prefill} onCancel={() => {}} transferInfo={transferInfo} />,
    )
    expect(html).toContain('Continuar')
  })

  it('la vista de instrucciones muestra datos bancarios y Ya transferí', () => {
    const html = renderToStaticMarkup(
      <PackageTransferInstructions transferInfo={transferInfo} amount={50000} currency="CLP" declaring={false} onDeclare={() => {}} />,
    )
    expect(html).toContain('BancoEstado')
    expect(html).toContain('12345678')
    expect(html).toContain('nombre en el asunto')
    expect(html).toContain('Ya transferí')
  })
})
