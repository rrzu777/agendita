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

  it('devuelve error amigable si Supabase falla', async () => {
    const signInWithOAuth = vi.fn().mockResolvedValue({ data: { url: null }, error: new Error('boom') })
    mockCreateClient.mockResolvedValue({ auth: { signInWithOAuth } })
    const { signInWithGoogle } = await import('@/lib/auth/actions')

    await expect(signInWithGoogle(null)).resolves.toEqual({ error: 'No se pudo iniciar sesión con Google. Intenta de nuevo.' })
  })
})
