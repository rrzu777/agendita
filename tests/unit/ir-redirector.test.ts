import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockFindUnique } = vi.hoisted(() => ({ mockFindUnique: vi.fn() }))
vi.mock('@/lib/db', () => ({ prisma: { business: { findUnique: mockFindUnique } } }))

import { GET } from '@/app/ir/[slug]/route'

function call(slug: string) {
  return GET(new Request('https://agendita.cl/ir/' + slug), { params: Promise.resolve({ slug }) })
}

describe('GET /ir/[slug]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('NEXT_PUBLIC_APP_DOMAIN', 'agendita.cl')
  })

  it('slug válido → 302 al funnel del subdominio con ?continuar=1', async () => {
    mockFindUnique.mockResolvedValue({ slug: 'salon-ana', subdomain: 'salonana' })
    const res = await call('salon-ana')
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('https://salonana.agendita.cl/book?continuar=1')
  })

  it('negocio sin subdominio → 302 al path /book/[slug]', async () => {
    mockFindUnique.mockResolvedValue({ slug: 'salon-ana', subdomain: null })
    const res = await call('salon-ana')
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('https://agendita.cl/book/salon-ana?continuar=1')
  })

  it('slug inexistente → 404', async () => {
    mockFindUnique.mockResolvedValue(null)
    const res = await call('nope')
    expect(res.status).toBe(404)
  })
  it('preserva acq/UTM/ref separados durante login sin reenviar credenciales o redirects libres', async () => {
    mockFindUnique.mockResolvedValue({ slug: 'salon-ana', subdomain: 'salonana' })
    const response = await GET(new Request('https://agendita.cl/ir/salon-ana?acq=abcdefghijklmnopqrstuv&ref=74d2b4a1-c53a-41d5-a145-5318f1d2d382&utm_source=ig&credential=secret&next=https://evil.test'), { params: Promise.resolve({ slug: 'salon-ana' }) })
    const location = new URL(response.headers.get('location')!)
    expect(Object.fromEntries(location.searchParams)).toEqual({ ref: '74d2b4a1-c53a-41d5-a145-5318f1d2d382', acq: 'abcdefghijklmnopqrstuv', utm_source: 'instagram', continuar: '1' })
    expect(location.origin).toBe('https://salonana.agendita.cl')
  })
})
