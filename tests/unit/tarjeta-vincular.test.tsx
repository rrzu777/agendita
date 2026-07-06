import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

const { mockGetCurrentUser, mockEnsure, mockLinkByToken, mockRedirect } = vi.hoisted(() => ({
  mockGetCurrentUser: vi.fn(),
  mockEnsure: vi.fn(),
  mockLinkByToken: vi.fn(),
  mockRedirect: vi.fn((url: string) => { throw new Error(`REDIRECT:${url}`) }),
}))

vi.mock('@/lib/auth/user', () => ({ getCurrentUser: mockGetCurrentUser }))
vi.mock('@/lib/auth/ensure-user-row', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/lib/auth/ensure-user-row')>()
  return { ...mod, ensureUserRow: mockEnsure }
})
vi.mock('@/lib/customers/link', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/lib/customers/link')>()
  return { ...mod, linkCustomerByLoyaltyToken: mockLinkByToken }
})
vi.mock('@/lib/db', () => ({ prisma: {} }))
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: vi.fn().mockResolvedValue({ success: true }) }))
vi.mock('next/navigation', () => ({ redirect: mockRedirect }))

import { CardLinkError } from '@/lib/customers/link'
import VincularPage from '@/app/tarjeta/[token]/vincular/page'

describe('/tarjeta/[token]/vincular', () => {
  beforeEach(() => vi.clearAllMocks())

  it('sin sesión → /ingresar con next de vuelta a vincular', async () => {
    mockGetCurrentUser.mockResolvedValue(null)
    await expect(VincularPage({ params: Promise.resolve({ token: 'tok1' }) }))
      .rejects.toThrow('REDIRECT:/ingresar?next=/tarjeta/tok1/vincular')
  })

  it('con sesión: vincula y redirige a /mi', async () => {
    mockGetCurrentUser.mockResolvedValue({ id: 'u1', email: 'a@b.c' })
    mockEnsure.mockResolvedValue(undefined)
    mockLinkByToken.mockResolvedValue(undefined)
    await expect(VincularPage({ params: Promise.resolve({ token: 'tok1' }) })).rejects.toThrow('REDIRECT:/mi')
    expect(mockLinkByToken).toHaveBeenCalledWith(expect.anything(), 'u1', 'tok1')
  })

  it('tarjeta ajena: muestra el error, no redirige', async () => {
    mockGetCurrentUser.mockResolvedValue({ id: 'u1', email: 'a@b.c' })
    mockEnsure.mockResolvedValue(undefined)
    mockLinkByToken.mockRejectedValue(new CardLinkError('Esta tarjeta ya está vinculada a otra cuenta.'))
    const html = renderToStaticMarkup(await VincularPage({ params: Promise.resolve({ token: 'tok1' }) }))
    expect(html).toContain('vinculada a otra cuenta')
  })
})
