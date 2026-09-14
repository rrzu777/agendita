import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ColorPicker } from '@/components/ui/color-picker'
import { ColorFavoritesProvider } from '@/components/dashboard/color-favorites-provider'

const { addFavorite, removeFavorite } = vi.hoisted(() => ({
  addFavorite: vi.fn(),
  removeFavorite: vi.fn(),
}))

vi.mock('@/server/actions/color-favorites', () => ({ addColorFavorite: addFavorite, removeColorFavorite: removeFavorite }))

function Picker({ value, onChange, canManage = true }: { value: string; onChange: (value: string) => void; canManage?: boolean }) {
  return (
    <ColorFavoritesProvider initialFavorites={['#35524A']} canManage={canManage}>
      <ColorPicker id="color" value={value} onChange={onChange} required label="Color de prueba" />
    </ColorFavoritesProvider>
  )
}

describe('ColorPicker', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    addFavorite.mockReset()
    removeFavorite.mockReset()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })

  it('keeps incomplete hexadecimal text authoritative while native input uses a safe value', async () => {
    let value = '#35524A'
    const render = async () => act(async () => root.render(<Picker value={value} onChange={(next) => { value = next }} />))
    await render()

    const hex = container.querySelector<HTMLInputElement>('#color')!
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
      setter.call(hex, '#12')
      hex.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await render()

    expect(hex.value).toBe('#12')
    expect(container.querySelector<HTMLInputElement>('input[type="color"]')?.value).toBe('#b64d68')
  })

  it('normalizes a valid native selection and lets a saved favorite update only the draft', async () => {
    let value = ''
    const render = async () => act(async () => root.render(<Picker value={value} onChange={(next) => { value = next }} />))
    await render()

    const native = container.querySelector<HTMLInputElement>('input[type="color"]')!
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
      setter.call(native, '#a1b2c3')
      native.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await render()
    expect(value).toBe('#A1B2C3')

    const favorite = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find((button) => button.getAttribute('aria-label') === 'Seleccionar favorito #35524A')!
    await act(async () => favorite.click())
    expect(value).toBe('#35524A')
    expect(addFavorite).not.toHaveBeenCalled()
  })

  it('keeps the controlled draft after a failed favorite save and exposes retry', async () => {
    addFavorite.mockResolvedValue({ ok: false, error: 'No se pudo guardar ahora' })
    let value = '#A1B2C3'
    const render = async () => act(async () => root.render(<Picker value={value} onChange={(next) => { value = next }} />))
    await render()

    const save = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find((button) => button.textContent?.includes('Guardar en favoritos'))!
    await act(async () => save.click())

    expect(value).toBe('#A1B2C3')
    expect(container.textContent).toContain('No se pudo guardar ahora')
    expect(container.querySelector<HTMLButtonElement>('[aria-label="Reintentar guardar favorito"]')).not.toBeNull()
  })
})
