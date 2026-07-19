import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

const { mockGetCurrentUser, mockEnsureUserRow, mockLink, mockRedirect } = vi.hoisted(() => ({
  mockGetCurrentUser: vi.fn(),
  mockEnsureUserRow: vi.fn(),
  mockLink: vi.fn(),
  mockRedirect: vi.fn((url: string) => { throw new Error(`REDIRECT:${url}`) }),
}))

// prepareMiUser usa getConfirmedSessionUser (getUser remoto) para el gate de
// email verificado; el mismo mock lo alimenta.
vi.mock('@/lib/auth/user', () => ({ getCurrentUser: mockGetCurrentUser, getConfirmedSessionUser: mockGetCurrentUser }))
vi.mock('@/lib/auth/ensure-user-row', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/lib/auth/ensure-user-row')>()
  return { ...mod, ensureUserRow: mockEnsureUserRow }
})
vi.mock('@/lib/customers/link', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/lib/customers/link')>()
  return { ...mod, linkCustomersByVerifiedEmail: mockLink }
})
vi.mock('@/lib/db', () => ({ prisma: {} }))
vi.mock('@/lib/auth/actions', () => ({ signOut: vi.fn() }))
vi.mock('next/navigation', () => ({ redirect: mockRedirect }))

import { AccountConflictError } from '@/lib/auth/ensure-user-row'
import MiLayout from '@/app/mi/layout'

const verifiedUser = {
  id: 'u1',
  email: 'ana@example.com',
  email_confirmed_at: '2026-01-01T00:00:00Z',
  user_metadata: { email_verified: true },
}

describe('/mi layout', () => {
  beforeEach(() => vi.clearAllMocks())

  it('redirige a /ingresar sin sesión', async () => {
    mockGetCurrentUser.mockResolvedValue(null)
    await expect(MiLayout({ children: null })).rejects.toThrow('REDIRECT:/ingresar?next=/mi')
  })

  it('con sesión: ensureUserRow + auto-link por email verificado, y renderiza children', async () => {
    mockGetCurrentUser.mockResolvedValue(verifiedUser)
    mockEnsureUserRow.mockResolvedValue(undefined)
    mockLink.mockResolvedValue(1)
    const html = renderToStaticMarkup(await MiLayout({ children: <p>contenido</p> }))
    expect(mockEnsureUserRow).toHaveBeenCalled()
    expect(mockLink).toHaveBeenCalledWith(expect.anything(), 'u1', 'ana@example.com')
    expect(html).toContain('contenido')
  })

  it('NO auto-linkea si el email no está verificado', async () => {
    mockGetCurrentUser.mockResolvedValue({ id: 'u1', email: 'ana@example.com', email_confirmed_at: null, user_metadata: {} })
    mockEnsureUserRow.mockResolvedValue(undefined)
    await MiLayout({ children: null })
    expect(mockLink).not.toHaveBeenCalled()
  })

  it('muestra mensaje de soporte ante AccountConflictError', async () => {
    mockGetCurrentUser.mockResolvedValue(verifiedUser)
    mockEnsureUserRow.mockRejectedValue(new AccountConflictError())
    const html = renderToStaticMarkup(await MiLayout({ children: null }))
    expect(html).toContain('soporte')
    expect(mockLink).not.toHaveBeenCalled()
  })
})
