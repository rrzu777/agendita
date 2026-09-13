import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

const mocks = vi.hoisted(() => ({ publicBusiness: vi.fn(), bookingBusiness: vi.fn(), subdomainBusiness: vi.fn(), tenant: vi.fn() }))
vi.mock('@/lib/business/public', () => ({
  getPublicBusinessBySlug: mocks.publicBusiness,
  getBookingBusinessBySlug: mocks.bookingBusiness,
  getBookingBusinessBySubdomain: mocks.subdomainBusiness,
}))
vi.mock('@/lib/tenant/resolver', () => ({ getTenantFromRequest: mocks.tenant }))

describe('tenant theme route layouts', () => {
  const tenant = { category: 'barber', brandColor: '#35524A', visualStyle: 'contrast' }

  it('mantiene el tema del perfil mientras carga o falla la ruta dinámica', async () => {
    mocks.publicBusiness.mockResolvedValue(tenant)
    const { default: Layout } = await import('@/app/b/[slug]/layout')
    const html = renderToStaticMarkup(await Layout({ children: <p>Cargando perfil</p>, params: Promise.resolve({ slug: 'barber' }) }))
    expect(html).toContain('data-business-theme')
    expect(html).toContain('data-visual-style="contrast"')
  })

  it('mantiene el tema del wizard mientras carga o falla la ruta dinámica', async () => {
    mocks.bookingBusiness.mockResolvedValue(tenant)
    const { default: Layout } = await import('@/app/book/[slug]/layout')
    const html = renderToStaticMarkup(await Layout({ children: <p>Cargando reserva</p>, params: Promise.resolve({ slug: 'barber' }) }))
    expect(html).toContain('data-business-theme')
    expect(html).toContain('Cargando reserva')
  })

  it('mantiene el tema del tenant en loading/error de la ruta canónica', async () => {
    mocks.tenant.mockResolvedValue({ subdomain: 'barber' })
    mocks.subdomainBusiness.mockResolvedValue(tenant)
    const { default: Layout } = await import('@/app/book/layout')
    const html = renderToStaticMarkup(await Layout({ children: <p>Cargando reserva canónica</p> }))
    expect(html).toContain('data-visual-style="contrast"')
    expect(html).toContain('Cargando reserva canónica')
  })

  it('degrada a shell neutral si falla el lookup del layout', async () => {
    mocks.publicBusiness.mockRejectedValueOnce(new Error('db unavailable'))
    mocks.tenant.mockRejectedValueOnce(new Error('db unavailable'))
    const { default: ProfileLayout } = await import('@/app/b/[slug]/layout')
    const { default: BookingLayout } = await import('@/app/book/layout')
    await expect(ProfileLayout({ children: <p>Perfil</p>, params: Promise.resolve({ slug: 'barber' }) })).resolves.toBeTruthy()
    await expect(BookingLayout({ children: <p>Reserva</p> })).resolves.toBeTruthy()
  })
})
