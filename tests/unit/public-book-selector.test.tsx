import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  tenant: vi.fn(),
}))

vi.mock('next/headers', () => ({ headers: vi.fn().mockResolvedValue(new Headers()) }))
vi.mock('@/lib/db', () => ({ prisma: { business: { findMany: mocks.findMany } } }))
vi.mock('@/lib/tenant/resolver', () => ({ getTenantFromRequest: mocks.tenant }))
vi.mock('@/lib/business/public', () => ({ getBookingBusinessBySubdomain: vi.fn() }))
vi.mock('@/lib/customers/session-prefill', () => ({ getFunnelSession: vi.fn() }))
vi.mock('@/lib/analytics/public-context', () => ({ isPublicAnalyticsEligible: vi.fn() }))
vi.mock('@/lib/analytics/budget', () => ({ getConfiguredAnalyticsConsentVersion: vi.fn() }))
vi.mock('@/components/analytics/public-analytics', () => ({ PublicAnalytics: ({ children }: { children: React.ReactNode }) => children }))

import BookIndexPage from '@/app/book/page'

describe('/book selector global', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.tenant.mockResolvedValue(null)
  })

  it('explica honestamente cuando no hay negocios visibles', async () => {
    mocks.findMany.mockResolvedValue([])
    const html = renderToStaticMarkup(await BookIndexPage({ searchParams: Promise.resolve({}) }))
    expect(html).toContain('No hay negocios disponibles')
    expect(html).toContain('enlace directo')
  })

  it('consulta uno extra, muestra diez y declara la truncación', async () => {
    mocks.findMany.mockResolvedValue(Array.from({ length: 11 }, (_, index) => ({ id: `b${index}`, slug: `negocio-${index}`, name: `Negocio ${index}` })))
    const html = renderToStaticMarkup(await BookIndexPage({ searchParams: Promise.resolve({}) }))
    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 11 }))
    expect(html).toContain('Negocio 9')
    expect(html).not.toContain('Negocio 10')
    expect(html).toContain('Mostramos los primeros 10 negocios')
  })
})
