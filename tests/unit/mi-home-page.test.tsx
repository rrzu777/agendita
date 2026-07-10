import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

const { mockPrepareMiUser, mockFindMany, mockBalance } = vi.hoisted(() => ({
  mockPrepareMiUser: vi.fn(),
  mockFindMany: vi.fn(),
  mockBalance: vi.fn(),
}))

vi.mock('@/lib/auth/mi-user', () => ({ prepareMiUser: mockPrepareMiUser }))
vi.mock('@/lib/db', () => ({ prisma: { customer: { findMany: mockFindMany } } }))
vi.mock('@/lib/loyalty/balance', () => ({ getLoyaltyBalance: mockBalance }))

import MiHomePage from '@/app/mi/page'

describe('/mi home', () => {
  beforeEach(() => vi.clearAllMocks())

  it('estado vacío sin Customer vinculados', async () => {
    mockPrepareMiUser.mockResolvedValue({ status: 'ok', user: { id: 'u1' } })
    mockFindMany.mockResolvedValue([])
    const html = renderToStaticMarkup(await MiHomePage())
    expect(html).toContain('tarjeta')
    expect(html).not.toContain('/mi/')
  })

  it('renderiza una card por negocio con el balance y link al detalle', async () => {
    mockPrepareMiUser.mockResolvedValue({ status: 'ok', user: { id: 'u1' } })
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
