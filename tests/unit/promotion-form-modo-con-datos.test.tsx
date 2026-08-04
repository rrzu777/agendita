import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'

const mockCreate = vi.hoisted(() => vi.fn())
const mockUpdate = vi.hoisted(() => vi.fn())

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))
vi.mock('@/server/actions/promotions', () => ({
  createPromotion: mockCreate,
  updatePromotion: mockUpdate,
}))

import { PromotionForm } from '@/app/dashboard/promociones/promotion-form'

const services = [{ id: 'svc-1', name: 'Corte' }]

const promo = {
  id: 'promo-1',
  name: 'Promo de invierno',
  description: null,
  code: 'INVIERNO',
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
}

function clickPorTexto(container: HTMLElement, texto: string) {
  const el = [...container.querySelectorAll('button')].find((b) => b.textContent?.includes(texto))
  if (!el) throw new Error(`No encontré el botón "${texto}"`)
  el.click()
}

/** Escribe en un input controlado por React: hay que pasar por el setter nativo
 *  para que el evento que ve React traiga el valor nuevo. */
function escribir(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
  setter.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

beforeAll(() => {
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  // jsdom no lo trae y los primitivos de Radix que usa el formulario (el switch
  // de "aplica a todos") lo miden al montar.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
})

afterAll(() => {
  delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT
})

/**
 * El modo y la promoción que se edita eran dos props sueltas, así que
 * `mode="edit"` sin `promo` compilaba: el diálogo decía "Editar promoción" y el
 * submit caía en `createPromotion`. La dueña apretaba Editar, no veía ningún
 * error, y quedaba una promoción DUPLICADA.
 *
 * Eso ahora no compila (ver `PromotionFormProps`). Lo que este test cuida es lo
 * otro: que adentro haya UN solo discriminante y que los dos modos sigan
 * llamando a la action que corresponde.
 */
describe('PromotionForm — el modo se lleva su promoción adentro', () => {
  it('editar llama a updatePromotion con el id, y no crea una nueva', async () => {
    mockUpdate.mockResolvedValue({ ok: true, data: {} })
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    await act(async () => {
      root.render(<PromotionForm mode="edit" promo={promo} services={services} currency="CLP" />)
    })
    await act(async () => { clickPorTexto(container, 'Editar') })

    // El diálogo abierto: título de edición y el nombre ya prellenado.
    expect(document.body.textContent).toContain('Editar promoción')
    expect([...document.querySelectorAll('input')].some((i) => i.value === 'Promo de invierno')).toBe(true)

    await act(async () => { clickPorTexto(document.body, 'Guardar cambios') })

    expect(mockUpdate).toHaveBeenCalledWith('promo-1', expect.objectContaining({ name: 'Promo de invierno' }))
    expect(mockCreate).not.toHaveBeenCalled()

    await act(async () => root.unmount())
    container.remove()
  }, 20_000)

  it('crear llama a createPromotion', async () => {
    mockCreate.mockResolvedValue({ ok: true, data: {} })
    mockUpdate.mockClear()
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    await act(async () => {
      root.render(<PromotionForm mode="create" services={services} currency="CLP" />)
    })
    await act(async () => { clickPorTexto(container, 'Nueva promoción') })

    // El formulario tiene campos `required` (nombre y valor del premio): sin
    // llenarlos el navegador no manda nada y el test estaría verificando la
    // validación del HTML en vez del modo. En edición vienen prellenados.
    const requeridos = [...document.querySelectorAll<HTMLInputElement>('input[required]')]
    await act(async () => {
      for (const input of requeridos) escribir(input, input.type === 'number' ? '20' : 'Promo nueva')
    })

    await act(async () => { clickPorTexto(document.body, 'Crear promoción') })

    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ name: 'Promo nueva' }))
    expect(mockUpdate).not.toHaveBeenCalled()

    await act(async () => root.unmount())
    container.remove()
  }, 20_000)
})
