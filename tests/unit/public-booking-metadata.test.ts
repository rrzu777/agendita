import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ getBusiness: vi.fn(), getSubdomainBusiness: vi.fn(), getTenant: vi.fn() }))

vi.mock('@/lib/business/public', () => ({
  getBookingBusinessBySlug: mocks.getBusiness,
  getBookingBusinessBySubdomain: mocks.getSubdomainBusiness,
}))
vi.mock('@/lib/tenant/resolver', () => ({ getTenantFromRequest: mocks.getTenant }))
vi.mock('next/headers', () => ({ headers: vi.fn().mockResolvedValue(new Headers()) }))

describe('public booking metadata', () => {
  it('names the tenant in the canonical booking route title', async () => {
    mocks.getBusiness.mockResolvedValue({ name: 'Mimos Nails' })
    const { generateMetadata } = await import('@/app/book/[slug]/page')

    await expect(generateMetadata({ params: Promise.resolve({ slug: 'mimosnails' }) })).resolves.toEqual({
      title: 'Mimos Nails — Reserva tu hora',
      description: 'Elige servicios, profesional y horario para reservar en Mimos Nails.',
    })
  })

  it('names the tenant on the subdomain booking route too', async () => {
    mocks.getTenant.mockResolvedValue({ subdomain: 'mimosnails' })
    mocks.getSubdomainBusiness.mockResolvedValue({ name: 'Mimos Nails' })
    const { generateMetadata } = await import('@/app/book/page')

    await expect(generateMetadata()).resolves.toEqual({
      title: 'Mimos Nails — Reserva tu hora',
      description: 'Elige servicios, profesional y horario para reservar en Mimos Nails.',
    })
  })
})
