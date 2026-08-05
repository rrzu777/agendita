import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, it, expect, vi } from 'vitest'
import { clickButton } from '../helpers/react-dom'

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
  isActive: true,
}

/** Escribe en un input controlado por React: hay que pasar por el setter nativo
 *  para que el evento que ve React traiga el valor nuevo. */
function escribir(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
  setter.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

/**
 * El modo y la promoción eran dos props independientes, así que `mode="edit"`
 * sin `promo` compilaba: el diálogo decía "Editar promoción" y el submit caía en
 * `createPromotion`. La dueña apretaba Editar, no veía ningún error, y quedaba
 * una promoción DUPLICADA.
 *
 * Ese estado ya no se puede escribir: `mode` no existe, se deriva de `promo`.
 * Lo que este test cuida es lo otro — que cada uno siga llamando a la action que
 * le toca.
 */
describe('PromotionForm — el modo sale de la promoción', () => {
  it('editar llama a updatePromotion con el id, y no crea una nueva', async () => {
    mockUpdate.mockResolvedValue({ ok: true, data: {} })
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    await act(async () => {
      root.render(<PromotionForm promo={promo} services={services} currency="CLP" />)
    })
    await clickButton(container, 'Editar', { match: 'contains' })

    // El diálogo abierto: título de edición y el nombre ya prellenado.
    expect(document.body.textContent).toContain('Editar promoción')
    expect([...document.querySelectorAll('input')].some((i) => i.value === 'Promo de invierno')).toBe(true)

    await clickButton(document.body, 'Guardar cambios', { match: 'contains' })

    expect(mockUpdate).toHaveBeenCalledWith('promo-1', expect.objectContaining({ name: 'Promo de invierno' }))
    expect(mockCreate).not.toHaveBeenCalled()

    await act(async () => root.unmount())
    container.remove()
  })

  it('crear llama a createPromotion', async () => {
    mockCreate.mockResolvedValue({ ok: true, data: {} })
    mockUpdate.mockClear()
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    await act(async () => {
      root.render(<PromotionForm services={services} currency="CLP" />)
    })
    await clickButton(container, 'Nueva promoción', { match: 'contains' })

    // El formulario tiene campos `required` (nombre y valor del premio): sin
    // llenarlos el navegador no manda nada y el test estaría verificando la
    // validación del HTML en vez del modo. En edición vienen prellenados.
    const requeridos = [...document.querySelectorAll<HTMLInputElement>('input[required]')]
    await act(async () => {
      for (const input of requeridos) escribir(input, input.type === 'number' ? '20' : 'Promo nueva')
    })

    await clickButton(document.body, 'Crear promoción', { match: 'contains' })

    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ name: 'Promo nueva' }))
    expect(mockUpdate).not.toHaveBeenCalled()

    await act(async () => root.unmount())
    container.remove()
  })
})
