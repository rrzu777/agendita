import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('@/lib/auth/actions', () => ({ signInWithGoogle: vi.fn() }))
vi.mock('next/navigation', () => ({ redirect: vi.fn() }))

import IngresarPage from '@/app/ingresar/page'

describe('/ingresar', () => {
  it('renderiza el botón de Google y el link para dueñas', async () => {
    const html = renderToStaticMarkup(await IngresarPage({ searchParams: Promise.resolve({}) }))
    expect(html).toContain('Google')
    expect(html).toContain('href="/login"')
  })

  it('muestra el error de OAuth cuando viene ?error=', async () => {
    const html = renderToStaticMarkup(await IngresarPage({ searchParams: Promise.resolve({ error: 'oauth' }) }))
    expect(html).toContain('No se pudo iniciar sesión con Google')
  })
})
