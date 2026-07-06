import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockCreateClient, mockRedirect } = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
  mockRedirect: vi.fn((url: string) => { throw new Error(`REDIRECT:${url}`) }),
}))

vi.mock('@/lib/auth/middleware', () => ({ createClient: mockCreateClient }))
vi.mock('@/lib/db', () => ({ prisma: {} }))
vi.mock('next/navigation', () => ({ redirect: mockRedirect }))

import { sanitizeNext } from '@/lib/auth/sanitize-next'

describe('sanitizeNext fallback', () => {
  it('mantiene el default /dashboard sin segundo argumento', () => {
    expect(sanitizeNext(null)).toBe('/dashboard')
    expect(sanitizeNext('//evil.com')).toBe('/dashboard')
  })
  it('usa el fallback provisto', () => {
    expect(sanitizeNext(null, '/mi')).toBe('/mi')
    expect(sanitizeNext('https://evil.com', '/mi')).toBe('/mi')
    expect(sanitizeNext('/mi/negocio', '/mi')).toBe('/mi/negocio')
  })
  it('bloquea backslash open-redirect (/\\evil.com → //evil.com al normalizar)', () => {
    expect(sanitizeNext('/\\evil.com')).toBe('/dashboard')
    expect(sanitizeNext('/\\/evil.com', '/mi')).toBe('/mi')
  })
})

describe('signInWithGoogle', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.NEXT_PUBLIC_APP_DOMAIN = 'agendita.test'
    process.env.APP_DOMAIN = 'agendita.test'
  })

  it('inicia OAuth con redirectTo al callback con next sanitizado y redirige a la URL de Google', async () => {
    const signInWithOAuth = vi.fn().mockResolvedValue({ data: { url: 'https://accounts.google.com/x' }, error: null })
    mockCreateClient.mockResolvedValue({ auth: { signInWithOAuth } })
    const { signInWithGoogle } = await import('@/lib/auth/actions')

    await expect(signInWithGoogle('/mi')).rejects.toThrow('REDIRECT:https://accounts.google.com/x')
    expect(signInWithOAuth).toHaveBeenCalledWith({
      provider: 'google',
      options: { redirectTo: 'https://agendita.test/auth/callback?next=%2Fmi' },
    })
  })

  it('sanitiza next malicioso al fallback /mi', async () => {
    const signInWithOAuth = vi.fn().mockResolvedValue({ data: { url: 'https://accounts.google.com/x' }, error: null })
    mockCreateClient.mockResolvedValue({ auth: { signInWithOAuth } })
    const { signInWithGoogle } = await import('@/lib/auth/actions')

    await expect(signInWithGoogle('//evil.com')).rejects.toThrow('REDIRECT:')
    expect(signInWithOAuth.mock.calls[0][0].options.redirectTo).toBe('https://agendita.test/auth/callback?next=%2Fmi')
  })

  it('si Supabase falla redirige a /ingresar con error visible (el form descarta returns)', async () => {
    const signInWithOAuth = vi.fn().mockResolvedValue({ data: { url: null }, error: new Error('boom') })
    mockCreateClient.mockResolvedValue({ auth: { signInWithOAuth } })
    const { signInWithGoogle } = await import('@/lib/auth/actions')

    await expect(signInWithGoogle(null)).rejects.toThrow('REDIRECT:/ingresar?error=oauth&next=%2Fmi')
  })
})

describe('authErrorRedirectPath', () => {
  it('flujos de clienta (/mi, /tarjeta) vuelven a /ingresar preservando next', async () => {
    const { authErrorRedirectPath } = await import('@/lib/auth/sanitize-next')
    expect(authErrorRedirectPath('/mi', 'auth_callback')).toBe('/ingresar?error=auth_callback&next=%2Fmi')
    expect(authErrorRedirectPath('/mi/mimosnails', 'missing_code')).toBe('/ingresar?error=missing_code&next=%2Fmi%2Fmimosnails')
    expect(authErrorRedirectPath('/tarjeta/tok1/vincular', 'auth_callback')).toBe('/ingresar?error=auth_callback&next=%2Ftarjeta%2Ftok1%2Fvincular')
  })

  it('flujos de dueña (default y otros next) siguen yendo a /login', async () => {
    const { authErrorRedirectPath } = await import('@/lib/auth/sanitize-next')
    expect(authErrorRedirectPath(null, 'missing_code')).toBe('/login?error=missing_code')
    expect(authErrorRedirectPath('/reset-password', 'auth_callback')).toBe('/login?error=auth_callback')
    expect(authErrorRedirectPath('/dashboard', 'auth_callback')).toBe('/login?error=auth_callback')
  })

  it('un next malicioso no cambia el destino del error (sanitizado primero)', async () => {
    const { authErrorRedirectPath } = await import('@/lib/auth/sanitize-next')
    expect(authErrorRedirectPath('//evil.com/mi', 'auth_callback')).toBe('/login?error=auth_callback')
    expect(authErrorRedirectPath('/mimosnails-fake', 'auth_callback')).toBe('/login?error=auth_callback')
  })
})
