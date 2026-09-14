import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { ClientRouteError } from '@/components/client/client-route-error'
import MiError from '@/app/mi/error'
import PackagesError from '@/app/paquetes/error'
import LoyaltyError from '@/app/tarjeta/error'
import ReviewError from '@/app/review/error'

describe('ClientRouteError', () => {
  it('offers recovery without exposing internal error details', () => {
    const html = renderToStaticMarkup(<ClientRouteError area="benefits" error={new Error('database secret')} retry={vi.fn()} />)
    expect(html).toContain('No pudimos cargar esta página')
    expect(html).toContain('Intentar de nuevo')
    expect(html).toContain('Volver a mi cuenta')
    expect(html).not.toContain('database secret')
    expect(html).toContain('Tus beneficios')
    expect(html).toContain('Volver a mi cuenta')
  })

  it('forwards the stable Next 16 retry prop from every route boundary', () => {
    const retry = vi.fn()
    for (const Boundary of [MiError, PackagesError, LoyaltyError, ReviewError]) {
      const element = Boundary({ error: new Error('boom'), retry } as never)
      expect(element.props.retry).toBe(retry)
      expect(element.props.area).toBeTruthy()
    }
  })
})
