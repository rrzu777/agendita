import { afterEach, describe, expect, it, vi } from 'vitest'
import { openDeferredPopup } from '@/lib/popup'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('openDeferredPopup', () => {
  it('abre una ventana en blanco en el acto (dentro del gesto)', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue({} as Window)
    openDeferredPopup()
    expect(open).toHaveBeenCalledWith('', '_blank')
  })

  it('navigate dirige la ventana ya abierta vía location.href', () => {
    const win = { location: { href: '' }, close: vi.fn() } as unknown as Window
    vi.spyOn(window, 'open').mockReturnValue(win)
    const popup = openDeferredPopup()
    popup.navigate('https://wa.me/569')
    expect(win.location.href).toBe('https://wa.me/569')
  })

  it('navigate cae a un open directo cuando el navegador no dio ventana', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    const popup = openDeferredPopup()
    popup.navigate('https://wa.me/569')
    expect(open).toHaveBeenNthCalledWith(1, '', '_blank')
    expect(open).toHaveBeenNthCalledWith(2, 'https://wa.me/569', '_blank')
  })

  it('close cierra la ventana en blanco', () => {
    const win = { close: vi.fn() } as unknown as Window
    vi.spyOn(window, 'open').mockReturnValue(win)
    openDeferredPopup().close()
    expect(win.close).toHaveBeenCalledOnce()
  })
})
