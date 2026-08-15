import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockHeaders, mockRedirect } = vi.hoisted(() => ({
  mockHeaders: vi.fn(),
  mockRedirect: vi.fn((destination: string) => { throw new Error(`REDIRECT:${destination}`) }),
}))

vi.mock('next/headers', () => ({ headers: mockHeaders }))
vi.mock('next/navigation', () => ({ redirect: mockRedirect }))

import InstallPage from '@/app/instalar/page'

describe('/instalar', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_APP_DOMAIN', 'www.agendita.cl')
    mockHeaders.mockResolvedValue(new Headers({ host: 'www.agendita.cl' }))
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.clearAllMocks()
  })

  it('explica el beneficio y reserva la acción para el componente interactivo', async () => {
    const html = renderToStaticMarkup(await InstallPage())

    expect(html).toContain('Instala Agendita')
    expect(html).toContain('Tus próximas citas, a un toque')
    expect(html).toContain('Instalar ahora')
    expect(html).toContain('href="/"')
  })

  it('redirige un host tenant al instalador del origen canónico', async () => {
    mockHeaders.mockResolvedValue(new Headers({
      host: 'tenant.agendita.cl',
      'x-forwarded-host': 'tenant.agendita.cl',
    }))

    await expect(InstallPage()).rejects.toThrow('REDIRECT:https://www.agendita.cl/instalar')
    expect(mockRedirect).toHaveBeenCalledWith('https://www.agendita.cl/instalar')
  })
})
