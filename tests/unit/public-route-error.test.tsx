import { describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { PublicRouteError } from '@/components/public/public-route-error'

describe('PublicRouteError', () => {
  it('explica el fallo y ofrece reintentar y volver sin perder navegación', async () => {
    const host = document.createElement('div')
    const root = createRoot(host)
    const reset = vi.fn()
    await act(async () => root.render(<PublicRouteError error={new Error('boom')} reset={reset} backHref="/b/test" />))
    expect(host.textContent).toContain('No pudimos cargar esta página')
    expect(host.querySelector('a')?.getAttribute('href')).toBe('/b/test')
    await act(async () => Array.from(host.querySelectorAll('button')).find((button) => button.textContent === 'Reintentar')?.click())
    expect(reset).toHaveBeenCalledOnce()
    await act(async () => root.unmount())
  })
})
