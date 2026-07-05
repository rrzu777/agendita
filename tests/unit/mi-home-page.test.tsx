import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

const { mockGetCurrentUser, mockFindMany, mockBalance, mockRedirect } = vi.hoisted(() => ({
  mockGetCurrentUser: vi.fn(),
  mockFindMany: vi.fn(),
  mockBalance: vi.fn(),
  mockRedirect: vi.fn((url: string) => { throw new Error(`REDIRECT:${url}`) }),
}))

vi.mock('@/lib/auth/user', () => ({ getCurrentUser: mockGetCurrentUser }))
vi.mock('@/lib/db', () => ({ prisma: { customer: { findMany: mockFindMany } } }))
vi.mock('@/lib/loyalty/balance', () => ({ getLoyaltyBalance: mockBalance }))
vi.mock('next/navigation', () => ({ redirect: mockRedirect }))

import MiHomePage from '@/app/mi/page'

describe('/mi home', () => {
  beforeEach(() => vi.clearAllMocks())

  it('estado vacío sin Customer vinculados', async () => {
    mockGetCurrentUser.mockResolvedValue({ id: 'u1' })
    mockFindMany.mockResolvedValue([])
    const html = renderToStaticMarkup(await MiHomePage())
    expect(html).toContain('tarjeta')
    expect(html).not.toContain('/mi/')
  })

  it('renderiza una card por negocio con el balance y link al detalle', async () => {
    mockGetCurrentUser.mockResolvedValue({ id: 'u1' })
    mockFindMany.mockResolvedValue([
      {
        id: 'c1', name: 'Ana',
        business: { id: 'b1', name: 'Mimos Nails', slug: 'mimosnails', logoUrl: null, loyaltyConfig: { isActive: true, pointsLabel: 'mimos' } },
      },
    ])
    mockBalance.mockResolvedValue(120)
    const html = renderToStaticMarkup(await MiHomePage())
    expect(html).toContain('Mimos Nails')
    expect(html).toContain('120')
    expect(html).toContain('mimos')
    expect(html).toContain('href="/mi/mimosnails"')
  })
})
