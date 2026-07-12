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
})
