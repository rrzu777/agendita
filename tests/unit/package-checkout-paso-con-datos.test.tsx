import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'

const mockCreatePurchase = vi.hoisted(() => vi.fn())

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }))
vi.mock('@/server/actions/packages-checkout', () => ({
  createPackagePurchase: mockCreatePurchase,
  initiatePackagePayment: vi.fn(),
  declarePackageTransfer: vi.fn(),
}))

import { PackageCheckout } from '@/components/packages/package-checkout'

const product = {
  id: 'p1', name: 'Pack 5', quantity: 5, bonusQuantity: 0, price: 50000,
  expiryDays: null, appliesToAll: true, serviceNames: [],
}
const prefill = { email: 'c@x.cl', name: 'Ana', phone: '+56 9 1111 2222' }
const transferInfo = {
  accountHolder: 'María P', rut: '1-9', bankName: 'BancoEstado', accountType: 'vista',
  accountNumber: '12345678', email: null, instructions: 'nombre en el asunto',
  holdHours: 48, requireProof: false,
}

function clickPorTexto(container: HTMLElement, texto: string) {
  const el = [...container.querySelectorAll('button')].find((b) => b.textContent?.includes(texto))
  if (!el) throw new Error(`No encontré el botón "${texto}"`)
  el.click()
}

// El mismo idioma que los otros tests de interacción del repo.
beforeAll(() => {
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(() => {
  delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT
})

/**
 * La pantalla de transferencia se elegía con
 * `step === 'transfer' && transferInfo && purchaseId`: una rama por ESTADO y
 * dos por DATOS en la misma condición. Si alguno de los datos faltaba, la
 * clienta no se quedaba trabada — caía en el formulario de una compra que YA
 * estaba creada, lista para crearla de nuevo. Ahora el id y la cuenta viven
 * adentro del paso, así que la pantalla no puede quedarse sin ellos.
 */
describe('PackageCheckout — el paso se lleva sus datos', () => {
  it('elegir transferencia lleva a las instrucciones, no de vuelta al formulario', async () => {
    mockCreatePurchase.mockResolvedValue({ ok: true, data: { purchaseId: 'pp-1' } })
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    await act(async () => {
      root.render(
        <PackageCheckout
          product={product}
          currency="CLP"
          prefill={prefill}
          onCancel={() => {}}
          transferInfo={transferInfo}
        />,
      )
    })

    // El formulario viene con los datos prellenados; falta aceptar términos.
    await act(async () => {
      const checkbox = container.querySelector('input[type="checkbox"]') as HTMLInputElement
      checkbox.click()
    })
    await act(async () => clickPorTexto(container, 'Continuar'))
    expect(container.textContent).toContain('Pagar con Mercado Pago')

    await act(async () => clickPorTexto(container, 'Transferencia bancaria'))

    // La compra ya existe: lo que se ve son las instrucciones, con la cuenta.
    expect(container.textContent).toContain('BancoEstado')
    expect(container.textContent).toContain('Ya transferí')
    // Y NO el formulario, que crearía una segunda compra por la misma plata.
    expect(container.textContent).not.toContain('Acepto los términos')

    await act(async () => root.unmount())
    container.remove()
  })
})
